"""Parse curl commands and forward HTTP requests."""

import base64
import re
import shlex
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urlparse

BINARY_CT_KEYWORDS = (
    "pdf",
    "octet-stream",
    "zip",
    "excel",
    "spreadsheet",
    "msword",
    "wordprocessing",
    "powerpoint",
    "ms-powerpoint",
    "/vnd.",
    "image/",
    "audio/",
    "video/",
)


def normalize_curl_text(text: str) -> str:
    text = text.strip()
    if text.lower().startswith("curl"):
        text = text[4:].strip()
    text = re.sub(r"\\\s*\n", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def parse_curl(text: str) -> dict:
    normalized = normalize_curl_text(text)
    if not normalized:
        raise ValueError("请输入 curl 命令")

    try:
        parts = shlex.split(normalized)
    except ValueError as e:
        raise ValueError(f"curl 解析失败: {e}")

    url = None
    method = "GET"
    headers: dict[str, str] = {}
    cookies: dict[str, str] = {}
    body = None

    i = 0
    while i < len(parts):
        arg = parts[i]
        if arg in ("-X", "--request"):
            i += 1
            if i >= len(parts):
                raise ValueError("缺少请求方法")
            method = parts[i].upper()
        elif arg in ("-H", "--header"):
            i += 1
            if i >= len(parts):
                raise ValueError("缺少 header 内容")
            header = parts[i]
            if ":" in header:
                name, value = header.split(":", 1)
                headers[name.strip()] = value.strip()
        elif arg in ("-b", "--cookie"):
            i += 1
            if i >= len(parts):
                raise ValueError("缺少 cookie 内容")
            for item in parts[i].split(";"):
                item = item.strip()
                if "=" in item:
                    key, value = item.split("=", 1)
                    cookies[key.strip()] = value.strip()
        elif arg in ("-d", "--data", "--data-raw", "--data-binary"):
            i += 1
            if i >= len(parts):
                raise ValueError("缺少 body 内容")
            body = parts[i]
            if method == "GET":
                method = "POST"
        elif arg.startswith("http://") or arg.startswith("https://"):
            url = arg
        elif not arg.startswith("-") and url is None:
            url = arg
        i += 1

    if not url:
        raise ValueError("未找到请求 URL")

    if cookies:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
        has_cookie = any(k.lower() == "cookie" for k in headers)
        if not has_cookie:
            headers["Cookie"] = cookie_header

    return {
        "url": url,
        "method": method,
        "headers": headers,
        "body": body,
    }


def normalize_port_mappings(mappings, default_port: int = 8000) -> dict[str, int]:
    result: dict[str, int] = {}
    if isinstance(mappings, dict):
        items = mappings.items()
    elif isinstance(mappings, list):
        items = [(item.get("domain", ""), item.get("port", default_port)) for item in mappings]
    else:
        return result

    for domain, port in items:
        key = str(domain).lower().strip()
        if not key:
            continue
        try:
            p = int(port)
            if 1 <= p <= 65535:
                result[key] = p
        except (TypeError, ValueError):
            continue
    return result


def resolve_port_for_host(host: str, default_port: int, port_mappings: dict[str, int]) -> int:
    host = (host or "").lower().strip()
    if host in port_mappings:
        return port_mappings[host]
    return default_port


def resolve_port_from_url(url: str, default_port: int, port_mappings: dict[str, int]) -> tuple[int, str | None]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host in port_mappings:
        return port_mappings[host], host
    return default_port, None


def to_local_url(url: str, port: int) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    return f"http://127.0.0.1:{port}{path}"


def localize_headers(
    headers: dict[str, str], default_port: int, port_mappings: dict[str, int]
) -> dict[str, str]:
    result = dict(headers)

    for key in list(result.keys()):
        lower = key.lower()
        if lower == "origin":
            parsed = urlparse(result[key])
            port = resolve_port_for_host(parsed.hostname or "", default_port, port_mappings)
            result[key] = f"http://127.0.0.1:{port}"
        elif lower == "referer":
            parsed = urlparse(result[key])
            port = resolve_port_for_host(parsed.hostname or "", default_port, port_mappings)
            result[key] = f"http://127.0.0.1:{port}{parsed.path or '/'}"
    return result


def build_curl(parsed: dict, local_url: str) -> str:
    lines = [f"curl '{local_url}'"]
    if parsed["method"] != "GET":
        lines.append(f"  -X {parsed['method']}")
    for name, value in parsed["headers"].items():
        lines.append(f"  -H '{name}: {value}'")
    if parsed["body"]:
        escaped = parsed["body"].replace("'", "'\\''")
        lines.append(f"  -d '{escaped}'")
    return " \\\n".join(lines)


def convert_curl(text: str, port: int, port_mappings: dict | list | None = None) -> dict:
    parsed = parse_curl(text)
    mappings = normalize_port_mappings(port_mappings or [], port)
    used_port, matched_domain = resolve_port_from_url(parsed["url"], port, mappings)
    local_url = to_local_url(parsed["url"], used_port)
    local_headers = localize_headers(parsed["headers"], port, mappings)
    local_parsed = {
        "url": local_url,
        "method": parsed["method"],
        "headers": local_headers,
        "body": parsed["body"],
    }
    return {
        "original_url": parsed["url"],
        "local_url": local_url,
        "local_curl": build_curl({**parsed, "headers": local_headers}, local_url),
        "request": local_parsed,
        "used_port": used_port,
        "matched_domain": matched_domain,
    }


def send_request(request: dict, timeout: int = 30, prefer_binary: bool = False) -> dict:
    url = request["url"]
    method = request.get("method", "GET").upper()
    headers = request.get("headers") or {}
    body = request.get("body")
    body_encoding = request.get("body_encoding", "utf-8")

    data = None
    if body is not None:
        if body_encoding == "base64":
            import base64
            data = base64.b64decode(body)
        else:
            data = body.encode("utf-8")

    req = urllib.request.Request(url, data=data, method=method)
    for name, value in headers.items():
        if name.lower() == "host":
            continue
        req.add_header(name, value)

    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            elapsed_ms = int((time.time() - start) * 1000)
            resp_headers = dict(resp.headers)
            body_payload = _build_response_body(raw, resp_headers, prefer_binary)
            return {
                "ok": True,
                "status": resp.status,
                "headers": resp_headers,
                "elapsed_ms": elapsed_ms,
                **body_payload,
            }
    except urllib.error.HTTPError as e:
        raw = e.read()
        elapsed_ms = int((time.time() - start) * 1000)
        resp_headers = dict(e.headers)
        body_payload = _build_response_body(raw, resp_headers, prefer_binary)
        return {
            "ok": True,
            "status": e.code,
            "headers": resp_headers,
            "elapsed_ms": elapsed_ms,
            **body_payload,
        }
    except urllib.error.URLError as e:
        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "error": f"请求失败: {e.reason}",
            "elapsed_ms": elapsed_ms,
        }
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "ok": False,
            "error": str(e),
            "elapsed_ms": elapsed_ms,
        }


def _filename_from_headers(headers: dict) -> str | None:
    for key, value in headers.items():
        if key.lower() != "content-disposition":
            continue
        match = re.search(r"filename\*=(?:UTF-8''|utf-8'')([^;\s]+)", value, re.I)
        if match:
            return unquote(match.group(1).strip().strip('"'))
        match = re.search(r'filename="([^"]+)"', value, re.I)
        if match:
            return match.group(1)
        match = re.search(r"filename=([^;\s]+)", value, re.I)
        if match:
            return match.group(1).strip('"')
    return None


def _get_content_type(headers: dict) -> str:
    for key, value in headers.items():
        if key.lower() == "content-type":
            return value
    return ""


def _is_binary_response(raw: bytes, content_type: str, headers: dict) -> bool:
    ct = (content_type or "").lower()
    disposition = ""
    for key, value in headers.items():
        if key.lower() == "content-disposition":
            disposition = value.lower()
            break

    if "attachment" in disposition:
        return True
    if _filename_from_headers(headers) and any(kw in ct for kw in BINARY_CT_KEYWORDS):
        return True
    for kw in BINARY_CT_KEYWORDS:
        if kw in ct:
            return True
    if ct.startswith("text/") or "json" in ct:
        try:
            text = raw.decode("utf-8")
            return text.count("\ufffd") > max(3, len(text) // 500)
        except UnicodeDecodeError:
            return True
    if not ct:
        try:
            raw.decode("utf-8")
            return False
        except UnicodeDecodeError:
            return True
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def _build_response_body(raw: bytes, resp_headers: dict, prefer_binary: bool) -> dict:
    content_type = _get_content_type(resp_headers)
    ct_main = content_type.split(";")[0].strip().lower() if content_type else ""

    if prefer_binary and _is_binary_response(raw, content_type, resp_headers):
        return {
            "body": base64.b64encode(raw).decode("ascii"),
            "body_encoding": "base64",
            "content_type": ct_main or "application/octet-stream",
            "filename": _filename_from_headers(resp_headers),
        }

    return {
        "body": _format_body(raw),
        "body_encoding": "utf-8",
        "content_type": ct_main or None,
        "filename": None,
    }


def _format_body(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    try:
        import json
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except (json.JSONDecodeError, ValueError):
        return text
