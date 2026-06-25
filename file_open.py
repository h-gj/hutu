"""Save downloaded files and open with the system default application."""

import os
import platform
import re
import subprocess
import tempfile
import time

TEMP_DIR = os.path.join(tempfile.gettempdir(), "hutu-downloads")


def ensure_temp_dir() -> str:
    os.makedirs(TEMP_DIR, exist_ok=True)
    return TEMP_DIR


def sanitize_filename(name: str) -> str:
    name = os.path.basename((name or "").strip()) or "download.bin"
    name = re.sub(r"[^\w.\-()+\s\u4e00-\u9fff]", "_", name)
    return name or "download.bin"


def save_binary_file(data: bytes, filename: str) -> str:
    directory = ensure_temp_dir()
    safe_name = sanitize_filename(filename)
    path = os.path.join(directory, safe_name)
    if os.path.exists(path):
        base, ext = os.path.splitext(safe_name)
        path = os.path.join(directory, f"{base}_{int(time.time())}{ext}")
    with open(path, "wb") as f:
        f.write(data)
    return path


def open_file_with_system(path: str) -> None:
    system = platform.system()
    if system == "Windows":
        os.startfile(path)  # type: ignore[attr-defined]
    elif system == "Darwin":
        subprocess.run(["open", path], check=False)
    else:
        subprocess.run(["xdg-open", path], check=False)


def save_and_open_file(data: bytes, filename: str) -> str:
    path = save_binary_file(data, filename)
    open_file_with_system(path)
    return path
