#!/usr/bin/env python3
"""HuTu personal tools local server."""

import ast
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dict_convert import json_to_python_dict, python_dict_to_json
from curl_utils import parse_curl, send_request
from file_open import save_and_open_file
from sql_utils import process_sql
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote

HOST = "127.0.0.1"
PORT = 8765
DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_FILE = os.path.join(DIR, "tools.json")
ADMIN_CONFIG_FILE = os.path.join(DIR, "admin_config.json")
DEV_SUBMISSIONS_FILE = os.path.join(DIR, "dev_submissions.json")
DEV_SUBMISSIONS_MAX = 100
NOTES_DIR = os.path.join(DIR, "notes")
MARKDOWN_DOCS_DIR = os.path.join(DIR, "markdown_docs")
NOTE_SLUG_RE = re.compile(r"^[a-z0-9]{3,32}$")
DOC_ID_RE = re.compile(r"^[a-z0-9]{10,16}$")
RESERVED_PATHS = frozenset(("/", "/index.html", "/favicon.ico"))
RESERVED_PREFIXES = ("/api/", "/static/", "/tools/", "/admin")
COOKIE_NAME = "hutu_session"
SESSION_MAX_AGE = 7 * 24 * 3600

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def load_catalog() -> dict:
    with open(TOOLS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_catalog(catalog: dict):
    with open(TOOLS_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_admin_config() -> dict:
    with open(ADMIN_CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def make_session(username: str, secret: str) -> str:
    exp = int(time.time()) + SESSION_MAX_AGE
    payload = f"{username}:{exp}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def verify_session(token: str, secret: str) -> str | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        username, exp, sig = raw.rsplit(":", 2)
        payload = f"{username}:{exp}"
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(exp) < time.time():
            return None
        return username
    except (ValueError, TypeError):
        return None


def slugify(text: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", text.strip().lower())
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug or "tool"


def load_dev_submissions() -> list:
    if not os.path.isfile(DEV_SUBMISSIONS_FILE):
        return []
    with open(DEV_SUBMISSIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_dev_submissions(items: list):
    with open(DEV_SUBMISSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
        f.write("\n")


def add_dev_submission(curl: str, submitter: str = "") -> dict:
    curl = curl.strip()
    if not curl:
        raise ValueError("curl 不能为空")
    submitter = (submitter or "").strip() or "未知"
    try:
        parsed = parse_curl(curl)
        method = parsed["method"]
        url = parsed["url"]
    except Exception:
        method = "GET"
        url = ""

    entry = {
        "id": int(time.time() * 1000),
        "time": int(time.time() * 1000),
        "curl": curl,
        "method": method,
        "url": url,
        "submitter": submitter,
    }
    items = load_dev_submissions()
    items.insert(0, entry)
    if len(items) > DEV_SUBMISSIONS_MAX:
        items = items[:DEV_SUBMISSIONS_MAX]
    save_dev_submissions(items)
    return entry


def ensure_notes_dir():
    os.makedirs(NOTES_DIR, exist_ok=True)


def note_file_path(slug: str) -> str:
    return os.path.join(NOTES_DIR, f"{slug}.txt")


def load_note(slug: str) -> dict:
    path = note_file_path(slug)
    if not os.path.isfile(path):
        return {"content": "", "updated_at": None}
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"content": content, "updated_at": int(os.path.getmtime(path) * 1000)}


def save_note(slug: str, content: str) -> int:
    ensure_notes_dir()
    path = note_file_path(slug)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp_path, path)
    return int(time.time() * 1000)


def ensure_markdown_docs_dir():
    os.makedirs(MARKDOWN_DOCS_DIR, exist_ok=True)


def markdown_doc_path(doc_id: str) -> str:
    return os.path.join(MARKDOWN_DOCS_DIR, f"{doc_id}.md")


def load_markdown_doc(doc_id: str) -> dict | None:
    path = markdown_doc_path(doc_id)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"content": content, "updated_at": int(os.path.getmtime(path) * 1000)}


def save_markdown_doc(doc_id: str, content: str) -> int:
    ensure_markdown_docs_dir()
    path = markdown_doc_path(doc_id)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp_path, path)
    return int(time.time() * 1000)


def create_markdown_doc(content: str) -> str:
    ensure_markdown_docs_dir()
    for _ in range(8):
        doc_id = secrets.token_hex(6)
        path = markdown_doc_path(doc_id)
        if not os.path.exists(path):
            save_markdown_doc(doc_id, content)
            return doc_id
    raise RuntimeError("无法生成文档 ID")


def is_note_slug_path(path: str) -> bool:
    if path in RESERVED_PATHS:
        return False
    for prefix in RESERVED_PREFIXES:
        if path.startswith(prefix):
            return False
    slug = path[1:] if path.startswith("/") else path
    return bool(NOTE_SLUG_RE.match(slug))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _get_cookie(self, name: str) -> str | None:
        cookie_header = self.headers.get("Cookie", "")
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith(name + "="):
                return part[len(name) + 1:]
        return None

    def _get_session_user(self) -> str | None:
        token = self._get_cookie(COOKIE_NAME)
        if not token:
            return None
        config = load_admin_config()
        return verify_session(token, config.get("secret", ""))

    def _set_session_cookie(self, token: str):
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_MAX_AGE}",
        )

    def _clear_session_cookie(self):
        self.send_header(
            "Set-Cookie",
            f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def do_GET(self):
        path = unquote(self.path.split("?")[0])

        if path == "/api/tools":
            self._json_response(load_catalog())
            return

        if path == "/api/admin/me":
            user = self._get_session_user()
            if user:
                self._json_response({"ok": True, "username": user})
            else:
                self._json_response({"ok": False}, status=401)
            return

        if path == "/api/request-local/dev-submissions":
            self._json_response({"ok": True, "items": load_dev_submissions()})
            return

        if path.startswith("/api/notes/"):
            slug = path[len("/api/notes/"):].strip("/")
            if not NOTE_SLUG_RE.match(slug):
                self.send_error(404)
                return
            self._json_response({"ok": True, **load_note(slug)})
            return

        if path.startswith("/api/markdown-doc/"):
            doc_id = path[len("/api/markdown-doc/"):].strip("/")
            if not DOC_ID_RE.match(doc_id):
                self.send_error(404)
                return
            doc = load_markdown_doc(doc_id)
            if doc is None:
                self._json_response({"ok": False, "error": "文档不存在"}, status=404)
                return
            self._json_response({"ok": True, "id": doc_id, **doc})
            return

        if path in ("/", "/index.html"):
            self._serve_file("index.html", "text/html; charset=utf-8")
            return

        if path in ("/admin/login", "/admin/login/"):
            if self._get_session_user():
                self._redirect("/admin/")
                return
            self._serve_file("admin/login.html", "text/html; charset=utf-8")
            return

        if path in ("/admin", "/admin/"):
            if not self._get_session_user():
                self._redirect("/admin/login")
                return
            self._serve_file("admin/index.html", "text/html; charset=utf-8")
            return

        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            self._serve_file(os.path.join("static", rel))
            return

        if path.startswith("/tools/"):
            rel = path[len("/tools/"):]
            if rel.endswith("/"):
                rel += "index.html"
            self._serve_file(os.path.join("tools", rel))
            return

        if is_note_slug_path(path):
            self._serve_file("tools/online-editor/editor.html", "text/html; charset=utf-8")
            return

        self.send_error(404)

    def do_PUT(self):
        path = unquote(self.path.split("?")[0])
        if path == "/api/admin/catalog":
            if not self._get_session_user():
                self._json_response({"ok": False, "error": "未登录"}, status=401)
                return
            self._handle_save_catalog()
            return
        if path.startswith("/api/notes/"):
            slug = path[len("/api/notes/"):].strip("/")
            if not NOTE_SLUG_RE.match(slug):
                self.send_error(404)
                return
            self._handle_save_note(slug)
            return
        if path.startswith("/api/markdown-doc/"):
            doc_id = path[len("/api/markdown-doc/"):].strip("/")
            if not DOC_ID_RE.match(doc_id):
                self.send_error(404)
                return
            self._handle_save_markdown_doc(doc_id)
            return
        self.send_error(404)

    def do_POST(self):
        path = unquote(self.path.split("?")[0])

        if path == "/api/admin/login":
            self._handle_login()
            return

        if path == "/api/admin/logout":
            self._handle_logout()
            return

        if path == "/api/dict-to-json/convert":
            self._handle_dict_to_json()
            return

        if path == "/api/sql-tool/process":
            self._handle_sql_tool()
            return

        if path == "/api/request-local/send":
            self._handle_request_local_send()
            return

        if path == "/api/request-local/submit-dev":
            self._handle_request_local_submit_dev()
            return

        if path == "/api/request-view/open-file":
            self._handle_request_view_open_file()
            return

        if path == "/api/markdown-doc":
            self._handle_create_markdown_doc()
            return

        if path.startswith("/api/notes/"):
            slug = path[len("/api/notes/"):].strip("/")
            if not NOTE_SLUG_RE.match(slug):
                self.send_error(404)
                return
            self._handle_save_note(slug)
            return

        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _handle_login(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            username = payload.get("username", "").strip()
            password = payload.get("password", "")
            config = load_admin_config()

            if username != config.get("username") or password != config.get("password"):
                self._json_response({"ok": False, "error": "用户名或密码错误"})
                return

            token = make_session(username, config.get("secret", ""))
            self._json_response({"ok": True}, extra_headers=lambda: self._set_session_cookie(token))
        except json.JSONDecodeError:
            self._json_response({"ok": False, "error": "请求格式错误"})

    def _handle_logout(self):
        self._json_response({"ok": True}, extra_headers=lambda: self._clear_session_cookie())

    def _handle_save_catalog(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            catalog = json.loads(body)
            if "categories" not in catalog or "tools" not in catalog:
                raise ValueError("数据格式错误，需要 categories 和 tools 字段")

            categories = catalog["categories"]
            tools = catalog["tools"]

            if not any(c["id"] == "all" for c in categories):
                categories.insert(0, {"id": "all", "name": "全部"})

            cat_ids = {c["id"] for c in categories if c["id"] != "all"}
            for tool in tools:
                if not tool.get("id"):
                    tool["id"] = slugify(tool.get("title", "tool"))
                if tool["category"] not in cat_ids:
                    raise ValueError(f"工具「{tool.get('title')}」的分类不存在")

            save_catalog({"categories": categories, "tools": tools})
            self._json_response({"ok": True})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"JSON 解析失败: {e}"})
        except (ValueError, KeyError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"保存失败: {e}"})

    def _handle_dict_to_json(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            text = payload.get("text", "")
            if not text.strip():
                raise ValueError("请输入待转换内容")
            direction = payload.get("direction", "to_json")
            if direction == "to_dict":
                result = json_to_python_dict(text)
            else:
                result = python_dict_to_json(text)
            self._json_response({"ok": True, "result": result})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, SyntaxError) as e:
            self._json_response({"ok": False, "error": f"解析失败: {e}"})
        except Exception as e:
            self._json_response({"ok": False, "error": f"转换失败: {e}"})

    def _handle_sql_tool(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            sql = payload.get("sql", "")
            dialect = payload.get("dialect", "mysql")
            keyword_case = payload.get("keyword_case", "upper")
            indent = payload.get("indent", 2)
            do_format = payload.get("format", True)
            do_validate = payload.get("validate", True)

            result = process_sql(
                sql,
                dialect=dialect,
                keyword_case=keyword_case,
                indent=int(indent),
                do_format=do_format,
                do_validate=do_validate,
            )
            if not result.get("ok"):
                self._json_response({"ok": False, "error": result.get("error", "处理失败")})
                return
            self._json_response({"ok": True, **result})
        except RuntimeError as e:
            self._json_response({"ok": False, "error": str(e)})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except Exception as e:
            self._json_response({"ok": False, "error": f"处理失败: {e}"})

    def _handle_request_local_send(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            request = payload.get("request")
            if not request or not request.get("url"):
                raise ValueError("缺少 request 参数")

            prefer_binary = bool(payload.get("prefer_binary", False))
            result = send_request(request, prefer_binary=prefer_binary)
            self._json_response(result)
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"发送失败: {e}"})

    def _handle_request_view_open_file(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            raw_b64 = payload.get("body")
            if not raw_b64:
                raise ValueError("缺少文件内容")
            filename = (payload.get("filename") or "").strip() or "download.bin"
            data = base64.b64decode(raw_b64)
            path = save_and_open_file(data, filename)
            self._json_response({"ok": True, "path": path})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"打开失败: {e}"})

    def _handle_request_local_submit_dev(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            curl = payload.get("curl", "")
            submitter = payload.get("submitter", "")
            entry = add_dev_submission(curl, submitter)
            self._json_response({"ok": True, "item": entry})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"提交失败: {e}"})

    def _handle_save_markdown_doc(self, doc_id: str):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            content = payload.get("content", "")
            if not isinstance(content, str):
                raise ValueError("content 必须是字符串")
            if load_markdown_doc(doc_id) is None:
                self._json_response({"ok": False, "error": "文档不存在"}, status=404)
                return
            updated_at = save_markdown_doc(doc_id, content)
            self._json_response({"ok": True, "id": doc_id, "updated_at": updated_at})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"保存失败: {e}"})

    def _handle_create_markdown_doc(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            content = payload.get("content", "")
            if not isinstance(content, str):
                raise ValueError("content 必须是字符串")
            if not content.strip():
                raise ValueError("文档内容不能为空")
            doc_id = create_markdown_doc(content)
            share_url = f"/tools/markdown-reviewer/?id={doc_id}"
            self._json_response({"ok": True, "id": doc_id, "url": share_url})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"创建失败: {e}"})

    def _handle_save_note(self, slug: str):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            payload = json.loads(body)
            content = payload.get("content", "")
            if not isinstance(content, str):
                raise ValueError("content 必须是字符串")
            updated_at = save_note(slug, content)
            self._json_response({"ok": True, "updated_at": updated_at})
        except json.JSONDecodeError as e:
            self._json_response({"ok": False, "error": f"请求格式错误: {e}"})
        except (ValueError, TypeError) as e:
            self._json_response({"ok": False, "error": str(e)})
        except Exception as e:
            self._json_response({"ok": False, "error": f"保存失败: {e}"})

    def _serve_file(self, rel_path: str, content_type: str = None):
        path = os.path.join(DIR, rel_path)
        if not os.path.isfile(path):
            self.send_error(404)
            return

        ext = os.path.splitext(path)[1].lower()
        if content_type is None:
            content_type = MIME.get(ext, "application/octet-stream")

        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json_response(self, data: dict, status: int = 200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            extra_headers()
        self.end_headers()
        self.wfile.write(body)


def main():
    server = HTTPServer((HOST, PORT), Handler)
    print(f"HuTu 已启动: http://{HOST}:{PORT}")
    print(f"管理后台: http://{HOST}:{PORT}/admin/")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
