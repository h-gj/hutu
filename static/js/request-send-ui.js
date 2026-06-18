/** Shared in-flight request UI: send button loading + hover cancel. */
const RequestSendUI = (() => {
  let abortController = null;
  let sendBtn = null;
  let sendWrap = null;
  let cancelBtn = null;
  let sendLabel = '发送';

  function init() {
    sendBtn = document.getElementById('send-btn');
    if (!sendBtn) return;

    sendLabel = sendBtn.textContent.trim() || '发送';

    sendWrap = document.getElementById('send-btn-wrap');
    if (!sendWrap) {
      sendWrap = document.createElement('div');
      sendWrap.id = 'send-btn-wrap';
      sendWrap.className = 'preview-send-wrap';
      sendBtn.parentNode.insertBefore(sendWrap, sendBtn);
      sendWrap.appendChild(sendBtn);
    }

    cancelBtn = document.getElementById('cancel-request-btn');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.id = 'cancel-request-btn';
      cancelBtn.className = 'send-cancel-btn';
      cancelBtn.textContent = '取消';
      sendWrap.appendChild(cancelBtn);
    }

    if (!cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = '1';
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelRequest();
      });
    }
  }

  function setSending(active) {
    const responseSection = document.querySelector('.response-section');

    if (sendWrap) sendWrap.classList.toggle('is-sending', active);
    if (sendBtn) {
      sendBtn.classList.toggle('is-sending', active);
      sendBtn.textContent = active ? '发送中' : sendLabel;
    }
    if (responseSection) responseSection.classList.toggle('is-loading', active);
  }

  function createSignal() {
    abortController = new AbortController();
    return abortController.signal;
  }

  function clearAbort() {
    abortController = null;
  }

  function cancelRequest() {
    if (abortController) abortController.abort();
  }

  function isAbortError(err) {
    return err?.name === 'AbortError';
  }

  return { init, setSending, createSignal, clearAbort, cancelRequest, isAbortError };
})();
