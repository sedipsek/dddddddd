# app.py
# pip install flask

import os
import json
import time
from pathlib import Path
from flask import (
    Flask, render_template, request, redirect, session,
    url_for, jsonify, Response, stream_with_context
)

BASE_DIR = Path(__file__).resolve().parent
OTP_FILE = BASE_DIR / "otp_store.json"
LOG_FILE = BASE_DIR / "server.log"

# ⬇ 파일 상단 쪽에 전역 상태 추가
LAST_SOURCE_TS = 0.0
SOURCE_IS_UP = False
SOURCE_TIMEOUT_SEC = 7   # 이 시간 동안 하트비트/로그가 없으면 끊김으로 간주


API_KEY = os.getenv("INGEST_API_KEY", "change-me")
BRAND = "치킨무(내 이름)"

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "please-change-this")

# ---------- Safe JSON load/save ----------
def load_store() -> dict:
    try:
        if not OTP_FILE.exists() or OTP_FILE.stat().st_size == 0:
            return {}
        with OTP_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_store(store: dict):
    tmp = OTP_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(OTP_FILE)

def append_logs(lines):
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(f"{line}\n")

@app.context_processor
def inject_brand():
    return dict(brand=BRAND)

# ---------- Pages ----------
@app.route("/")
def index():
    return redirect(url_for("logs") if session.get("user") else url_for("login"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user"):
        return redirect(url_for("logs"))

    if request.method == "POST":
        otp_input = (request.form.get("otp") or "").strip()
        store = load_store()
        now = int(time.time())

        for user_id, data in list(store.items()):
            if data.get("used"):
                continue
            if data.get("otp") == otp_input and now < int(data.get("expire", 0)):
                data["used"] = True
                save_store(store)
                session["user"] = user_id
                return redirect(url_for("logs"))

        return render_template("login.html", error="OTP가 잘못되었거나 만료되었습니다.")
    return render_template("login.html")

@app.route("/logs")
def logs():
    if "user" not in session:
        return redirect(url_for("login"))

    # 첫 로드시 최근 500줄만 렌더링
    if LOG_FILE.exists():
        with LOG_FILE.open("r", encoding="utf-8") as f:
            lines = f.readlines()[-500:]
    else:
        lines = ["(로그 없음)"]

    return render_template("logs.html", logs=lines)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# ---------- Ingest from plugin ----------
# ⬇ /ingest 라우트 안에서, lines 저장 후 마지막에 타임스탬프 갱신
@app.post("/ingest")
def ingest():
    if request.headers.get("X-API-Key") != API_KEY:
        return jsonify({"ok": False, "error": "forbidden"}), 403
    data = request.get_json(force=True, silent=True) or {}
    lines = data.get("lines", [])
    if not isinstance(lines, list):
        return jsonify({"ok": False, "error": "invalid payload"}), 400

    append_logs(lines)

    # ★ 최근 수신 시각 갱신
    global LAST_SOURCE_TS, SOURCE_IS_UP
    LAST_SOURCE_TS = time.time()
    SOURCE_IS_UP = True

    return jsonify({"ok": True, "count": len(lines)})


# ---------- SSE stream: tail -f ----------
# ⬇ SSE 스트림에서 down/up 이벤트 송출 로직 추가
@app.get("/stream-logs")
def stream_logs():
    def event_stream():
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOG_FILE.touch(exist_ok=True)

        with LOG_FILE.open("r", encoding="utf-8") as f:
            f.seek(0, os.SEEK_END)
            yield "retry: 2000\n\n"

            last_sent_state = None  # None/True/False
            last_ping = 0.0

            while True:
                where = f.tell()
                line = f.readline()
                now = time.time()

                # ── 소스(플러그인) 상태 판단
                global LAST_SOURCE_TS, SOURCE_IS_UP
                alive = (now - LAST_SOURCE_TS) <= SOURCE_TIMEOUT_SEC if LAST_SOURCE_TS else False
                if alive != last_sent_state:
                    # 상태 바뀌면 이벤트 전송
                    if alive:
                        yield "event: source_up\ndata: 1\n\n"
                    else:
                        yield "event: source_down\ndata: 0\n\n"
                    last_sent_state = alive

                if line:
                    yield f"data: {line.rstrip()}\n\n"
                else:
                    # 주기적 서버 하트비트(브라우저 연결 유지)
                    if now - last_ping >= 1.0:
                        yield f"event: ping\ndata: {int(now)}\n\n"
                        last_ping = now
                    time.sleep(0.5)
                    f.seek(where)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return Response(stream_with_context(event_stream()), headers=headers)


@app.get("/health")
def health():
    return jsonify({"ok": True})

# ⬇ 플러그인 하트비트용 엔드포인트 추가
@app.get("/heartbeat")
def heartbeat():
    if request.headers.get("X-API-Key") != API_KEY:
        return jsonify({"ok": False, "error": "forbidden"}), 403
    global LAST_SOURCE_TS, SOURCE_IS_UP
    LAST_SOURCE_TS = time.time()
    SOURCE_IS_UP = True
    return jsonify({"ok": True, "ts": LAST_SOURCE_TS})


if __name__ == "__main__":
    # reloader가 두 프로세스를 띄워서 SSE가 중복될 수 있으니 끔
    app.run(debug=True, threaded=True, use_reloader=False)
