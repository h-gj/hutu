"""SQL formatting and syntax validation."""

from __future__ import annotations

import re
from typing import Any


DIALECTS = [
    ("mysql", "MySQL"),
    ("postgres", "PostgreSQL"),
    ("sqlite", "SQLite"),
    ("oracle", "Oracle"),
    ("tsql", "SQL Server"),
]


def format_sql(
    sql: str,
    keyword_case: str = "upper",
    indent: int = 2,
) -> str:
    try:
        import sqlparse
    except ImportError:
        raise RuntimeError("缺少依赖 sqlparse，请执行: pip install sqlparse")

    if not sql.strip():
        raise ValueError("请输入 SQL")

    case = keyword_case.lower()
    if case == "upper":
        kw_case = "upper"
    elif case == "lower":
        kw_case = "lower"
    else:
        kw_case = None

    return sqlparse.format(
        sql,
        reindent=True,
        keyword_case=kw_case,
        indent_width=max(1, min(int(indent), 8)),
        strip_comments=False,
        wrap_after=80,
    )


def _normalize_parse_error(err: Any) -> dict[str, Any]:
    if isinstance(err, dict):
        msg = err.get("description") or str(err)
        line = err.get("line")
        col = err.get("col")
        highlight = err.get("highlight")
    else:
        msg = getattr(err, "description", None) or str(err)
        line = getattr(err, "line", None)
        col = getattr(err, "col", None)
        highlight = getattr(err, "highlight", None)

    text = str(msg)
    if "Expected" in text and "but got" in text:
        m = re.search(r"Expected (.+?) but got", text)
        if m:
            text = f"期望 {m.group(1)}"
    if highlight:
        text = f"{text}（near `{highlight}`）"

    return {"message": text, "line": line, "column": col}


def validate_sql(sql: str, dialect: str = "mysql") -> dict[str, Any]:
    try:
        from sqlglot import parse
        from sqlglot.errors import ParseError
    except ImportError:
        raise RuntimeError("缺少依赖 sqlglot，请执行: pip install sqlglot")

    stripped = sql.strip()
    if not stripped:
        return {
            "valid": False,
            "errors": [{"message": "SQL 为空", "line": None, "column": None}],
            "warnings": [],
        }

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    for item in _structural_checks(stripped):
        errors.append(item)

    dialect = dialect if dialect in {d[0] for d in DIALECTS} else "mysql"

    try:
        parse(stripped, dialect=dialect)
    except ParseError as exc:
        for err in exc.errors:
            errors.append(_normalize_parse_error(err))
        if not exc.errors:
            errors.append({"message": str(exc), "line": None, "column": None})

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "dialect": dialect,
    }


def process_sql(
    sql: str,
    dialect: str = "mysql",
    keyword_case: str = "upper",
    indent: int = 2,
    do_format: bool = True,
    do_validate: bool = True,
) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True}

    if do_validate:
        validation = validate_sql(sql, dialect=dialect)
        result["validation"] = validation

    if do_format:
        try:
            result["formatted"] = format_sql(sql, keyword_case=keyword_case, indent=indent)
        except ValueError as e:
            result["ok"] = False
            result["error"] = str(e)
            return result

    if do_validate and not result.get("validation", {}).get("valid", True):
        result["ok"] = True  # still return formatted output if possible

    return result


def _structural_checks(sql: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []

    quote_err = _check_quotes(sql)
    if quote_err:
        errors.append(quote_err)

    paren_err = _check_balanced(sql, "(", ")", "圆括号")
    if paren_err:
        errors.append(paren_err)

    return errors


def _check_quotes(sql: str) -> dict[str, Any] | None:
    in_single = False
    in_double = False
    escape = False
    line = 1
    col = 0

    for ch in sql:
        if ch == "\n":
            line += 1
            col = 0
            continue
        col += 1

        if escape:
            escape = False
            continue

        if ch == "\\":
            escape = True
            continue

        if not in_double and ch == "'":
            in_single = not in_single
            continue

        if not in_single and ch == '"':
            in_double = not in_double
            continue

    if in_single:
        return {"message": "单引号未闭合", "line": line, "column": col}
    if in_double:
        return {"message": "双引号未闭合", "line": line, "column": col}
    return None


def _check_balanced(sql: str, open_ch: str, close_ch: str, label: str) -> dict[str, Any] | None:
    depth = 0
    in_single = False
    in_double = False
    escape = False
    line = 1
    col = 0
    err_line = None
    err_col = None

    for ch in sql:
        if ch == "\n":
            line += 1
            col = 0
            continue
        col += 1

        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue

        if not in_double and ch == "'":
            in_single = not in_single
            continue
        if not in_single and ch == '"':
            in_double = not in_double
            continue
        if in_single or in_double:
            continue

        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth < 0:
                err_line = line
                err_col = col
                break

    if depth > 0 and err_line is None:
        err_line = line
        err_col = col

    if depth != 0:
        msg = f"{label}不匹配" if depth > 0 else f"{label}多余闭合"
        return {"message": msg, "line": err_line, "column": err_col}
    return None
