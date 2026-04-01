/**
 * Capturely Remote - Mobile Peer logic
 * Connects to the desktop extension via PeerJS and streams the mobile screen.
 * v1.1 - Added diagnostic logging and explicit signaling server forcing.
 */

(function() {
  'use strict';

  const btnShare = document.getElementById('btnShare');
  const btnStop = document.getElementById('btnStop');
  const statusDisplay = document.getElementById('connectionStatus');
  const logConsole = document.getElementById('logConsole');
  const setupView = document.getElementById('setup');
  const streamingView = document.getElementById('streaming');

  let peer = null;
  let desktopPeerId = null;
  let dataConn = null;
  let mediaConnection = null;
  let localStream = null;
  let connectionRetries = 0;
  const MAX_RETRIES = 5;
  const CONNECT_TIMEOUT_MS = 15000;

  function log(msg, error = false) {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement('div');
    div.style.color = error ? '#ff7777' : '#aaa';
    div.textContent = `[${time}] ${msg}`;
    logConsole.appendChild(div);
    logConsole.scrollTop = logConsole.scrollHeight;
    console.log(`[Capturely:Mobile] ${msg}`);
  }

  log('Application initialized v1.1');

  // 1. Get Desktop Peer ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  desktopPeerId = urlParams.get('id');

  if (!desktopPeerId) {
    log('Error: No pairing ID provided in URL.', true);
    statusDisplay.textContent = 'Error: No pairing ID provided.';
    statusDisplay.style.color = '#ff4444';
    return;
  }
  log(`Desktop ID parsed: ${desktopPeerId}`);

  // 2. Initialize PeerJS with explicit signaling server
  function initPeer() {
    log('Initializing PeerJS client...');
    if (peer) {
      peer.destroy();
    }

    // Explicitly set the PeerJS cloud server to ensure both sides are on the same signaling instance
    peer = new Peer(undefined, {
      host: '0.peerjs.com',
      secure: true,
      port: 443,
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', (id) => {
      log(`My peer ID is: ${id}`);
      statusDisplay.textContent = 'Connecting...';
      statusDisplay.style.color = '#f0a030';
      connectToDesktop();
    });

    peer.on('error', (err) => {
      log(`Peer error: ${err.type} - ${err.message}`, true);

      if (err.type === 'peer-unavailable') {
        statusDisplay.textContent = 'Desktop not found.';
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          log(`Retry ${connectionRetries}/${MAX_RETRIES} in 3s...`);
          setTimeout(() => initPeer(), 3000);
        }
      } else if (err.type === 'network') {
        statusDisplay.textContent = 'Network error.';
      } else {
        statusDisplay.textContent = 'Error: ' + err.type;
      }
      statusDisplay.style.color = '#ff4444';
    });
  }

  function connectToDesktop() {
    log(`Connecting to desktop: ${desktopPeerId}...`);

    const connectTimer = setTimeout(() => {
      if (!dataConn || !dataConn.open) {
        log('Data connection timed out.', true);
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          setTimeout(() => connectToDesktop(), 1000);
        }
      }
    }, CONNECT_TIMEOUT_MS);

    // Reliable: true is important for the PAIRED handshake
    dataConn = peer.connect(desktopPeerId, { reliable: true });

    dataConn.on('open', () => {
      clearTimeout(connectTimer);
      log('Data channel OPEN. Waiting for desktop ACK...');
      statusDisplay.textContent = 'Handshaking...';
      statusDisplay.style.color = '#30d060';
    });

    dataConn.on('data', (data) => {
      log(`Data received: ${JSON.stringify(data)}`);
      if (data && data.type === 'PAIRED') {
        log('Desktop paired successfully!');
        statusDisplay.textContent = 'Ready to stream';
        statusDisplay.style.color = '#30d060';
        btnShare.classList.remove('hidden');
      }
    });
    
    dataConn.on('close', () => {
      log('Data connection closed.', true);
      statusDisplay.textContent = 'Connection closed.';
      statusDisplay.style.color = '#ff4444';
      btnShare.classList.add('hidden');
    });

    peer.on('disconnected', () => {
      console.warn('[Capturely:Mobile] Disconnected from signaling server.');
      log('Disconnected from signaling. Attempting reconnect...', true);
      statusDisplay.textContent = 'Disconnected. Reconnecting...';
      statusDisplay.style.color = '#f0a030';
      if (peer && !peer.destroyed && peer.disconnected) {
        peer.reconnect();
      }
    });
  }

  // 3. Handle Screen Sharing
  btnShare.addEventListener('click', async () => {
    try {
      log('Requesting screen share permission...');
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      log('Screen stream obtained.');
      mediaConnection = peer.call(desktopPeerId, localStream);

      mediaConnection.on('error', (err) => log(`Media error: ${err.message}`, true));
      
      setupView.classList.add('hidden');
      streamingView.classList.remove('hidden');

      localStream.getVideoTracks()[0].onended = () => {
        log('Screen stream ended by OS.');
        stopStreaming();
      };

    } catch (err) {
      log(`Stream failed: ${err.name}`, true);
      alert('Error: ' + err.message);
    }
  });

  btnStop.addEventListener('click', stopStreaming);

  function stopStreaming() {
    log('Stopping stream.');
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    setupView.classList.remove('hidden');
    streamingView.classList.add('hidden');
    btnShare.classList.remove('hidden');
  }

  initPeer();

})();
