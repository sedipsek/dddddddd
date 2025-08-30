function setupOtpInputs({ gridSelector, boxSelector, hiddenSelector, formSelector }) {
  const grid = document.querySelector(gridSelector);
  if (!grid) return;

  const boxes = Array.from(grid.querySelectorAll(boxSelector));
  const hidden = document.querySelector(hiddenSelector);
  const form = document.querySelector(formSelector);

  boxes[0]?.focus();

  boxes.forEach((box, idx) => {
    box.addEventListener("input", (e) => {
      const v = e.target.value.replace(/\D/g, "");
      e.target.value = v.slice(-1);
      if (e.target.value && idx < boxes.length - 1) {
        boxes[idx + 1].focus();
        boxes[idx + 1].select?.();
      }
      updateHidden();
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && idx > 0) {
        boxes[idx - 1].focus();
        boxes[idx - 1].select?.();
      }
      if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
      if (e.key === "ArrowRight" && idx < boxes.length - 1) boxes[idx + 1].focus();
    });

    box.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text) return;
      e.preventDefault();
      const digits = text.replace(/\D/g, "").slice(0, boxes.length).split("");
      boxes.forEach((b, i) => (b.value = digits[i] || ""));
      updateHidden();
      const lastFilled = Math.min(digits.length, boxes.length) - 1;
      boxes[Math.max(0, lastFilled)]?.focus();
    });
  });

  function updateHidden() {
    const value = boxes.map((b) => b.value).join("");
    if (hidden) hidden.value = value;
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      updateHidden();
      const val = hidden?.value || "";
      if (!/^\d{6}$/.test(val)) {
        e.preventDefault();
        alert("6자리 숫자 OTP를 입력하세요.");
        boxes[0]?.focus();
      }
    });
  }
}

/* ──────────────────────────────────────────────────────────
   민감정보 마스킹
   - IPv4/IPv6, 이메일, 토큰/키, Authorization, X-API-Key,
     URL 쿼리의 password/token/key/secret, 긴 HEX/JWT, MAC 등
   - 화면 출력 전에만 가림(원본 파일은 변경 안 함)
   ────────────────────────────────────────────────────────── */
function sanitizeLine(line) {
  if (!line) return line;

  let s = line;

  // IPv4
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]");

  // IPv6 (간단 패턴)
  s = s.replace(/\b(?:[A-Fa-f0-9]{0,4}:){2,}[A-Fa-f0-9]{0,4}\b/g, "[IP6]");

  // MAC 주소
  s = s.replace(/\b(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}\b/g, "[MAC]");

  // 이메일
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]");

  // URL 자격증명 user:pass@
  s = s.replace(/(https?:\/\/)([^\/\s:@]+):([^@\/\s]+)@/gi, "$1***:***@");

  // Authorization 헤더/값, X-API-Key 등
  s = s.replace(/Authorization\s*:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]");
  s = s.replace(/Authorization\s*:\s*[^\s]+/gi, "Authorization: [REDACTED]");
  s = s.replace(/X-API-KEY\s*:\s*[^\s]+/gi, "X-API-Key: [REDACTED]");

  // URL 쿼리의 민감 파라미터
  s = s.replace(/([?&])(password|passwd|pwd|token|api[_-]?key|secret|key)=([^&#\s]+)/gi, "$1$2=[REDACTED]");

  // 긴 HEX 토큰(32자 이상)
  s = s.replace(/\b[a-f0-9]{32,}\b/gi, "[HEX]");

  // JWT 토큰 형태 aaaa.bbbb.cccc
  s = s.replace(/\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g, "[JWT]");

  // 윈도 경로 / 리눅스 홈 경로(선택적으로 가림)
  s = s.replace(/[A-Za-z]:\\[^\s"]+/g, "[PATH]");
  s = s.replace(/\/home\/[^\s"]+/g, "[PATH]");

  return s;
}

function setupLogs({ preSelector, searchSelector, autoscrollSelector, copySelector, sseUrl = "/stream-logs" }) {
  const pre = document.querySelector(preSelector);
  const search = document.querySelector(searchSelector);
  const autoscroll = document.querySelector(autoscrollSelector);
  const copyBtn = document.querySelector(copySelector);
  if (!pre) return;

  // 상태 표시 엘리먼트(없으면 생성)
  let statusEl = document.getElementById("status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.id = "status";
    statusEl.style.margin = "8px 0";
    statusEl.style.fontSize = "14px";
    pre.parentElement.parentElement.insertBefore(statusEl, pre.parentElement);
  }
  const setStatus = (text, type = "") => {
    statusEl.textContent = text || "";
    statusEl.style.color = type === "ok" ? "#34d399" : type ? "#fbbf24" : "";
  };

  // 초기 내용 → 버퍼(마스킹 적용)
  let buffer = pre.textContent ? pre.textContent.split("\n").map(sanitizeLine) : [];
  const MAX_LINES = 5000;

  function render() {
    const q = (search?.value || "").toLowerCase();
    if (!q) pre.textContent = buffer.join("\n");
    else pre.textContent = buffer.filter((l) => l.toLowerCase().includes(q)).join("\n");
    if (autoscroll?.checked) pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
  }

  // 검색/복사
  search?.addEventListener("input", render);
  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent);
      const t = copyBtn.textContent;
      copyBtn.textContent = "복사됨";
      setTimeout(() => (copyBtn.textContent = t), 1200);
    } catch {}
  });

  if (autoscroll?.checked) {
    pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
  }

  // ===== SSE 연결 + 상태 처리 =====
  if ("EventSource" in window) {
    const es = new EventSource(sseUrl);
    let lastBeat = Date.now();
    let disconnected = false;   // 끊김 상태에서만 메시지 표시

    // 소스 다운 → 버퍼 초기화 + '서버 연결 끊김'만 표시
    es.addEventListener("source_down", () => {
      buffer = [];
      render();
      if (!disconnected) setStatus("서버 연결 끊김 — 재연결 중…", "warn");
      disconnected = true;
    });

    // 소스 업 → 재연결됨 한 번만 표시
    es.addEventListener("source_up", () => {
      if (disconnected) {
        setStatus("재연결됨", "ok");
        setTimeout(() => setStatus(""), 1500);
      }
      disconnected = false;
    });

    // 서버 하트비트: 상태 문구 갱신 안 함(깜빡임 제거)
    es.addEventListener("ping", () => {
      lastBeat = Date.now();
    });

    es.onmessage = (ev) => {
      lastBeat = Date.now();
      if (!ev.data) return;
      const safe = sanitizeLine(ev.data);
      buffer.push(safe);
      if (buffer.length > MAX_LINES) buffer = buffer.slice(-Math.floor(MAX_LINES * 0.8));
      render();
    };

    es.onerror = () => {
      // SSE 자체 에러도 끊김으로 간주(중복 메시지 방지)
      if (!disconnected) {
        buffer = [];
        render();
        setStatus("서버 연결 끊김 — 재연결 중…", "warn");
        disconnected = true;
      }
    };

    // 하트비트 기준 끊김 감지(추가 안전장치) → 동일한 문구만 표시
    setInterval(() => {
      if (Date.now() - lastBeat > 5000 && !disconnected) {
        buffer = [];
        render();
        setStatus("서버 연결 끊김 — 재연결 중…", "warn");
        disconnected = true;
      }
    }, 1000);
  } else {
    // 구형 브라우저 폴링
    setInterval(render, 2000);
  }
}
