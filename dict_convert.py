"""Convert between Python dict literals and JSON."""

import ast
import json


def python_dict_to_json(text: str) -> str:
    data = ast.literal_eval(text.strip())
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_python_value(value, indent: int = 0) -> str:
    space = "  " * indent
    inner = "  " * (indent + 1)

    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        lines = [f"{inner}{_format_python_value(item, indent + 1)}" for item in value]
        return "[" + "\n" + ",\n".join(lines) + "\n" + space + "]"
    if isinstance(value, dict):
        if not value:
            return "{}"
        lines = []
        for key, val in value.items():
            key_repr = repr(key) if isinstance(key, str) else str(key)
            lines.append(f"{inner}{key_repr}: {_format_python_value(val, indent + 1)}")
        return "{" + "\n" + ",\n".join(lines) + "\n" + space + "}"
    return repr(value)


def json_to_python_dict(text: str) -> str:
    data = json.loads(text.strip())
    return _format_python_value(data)
