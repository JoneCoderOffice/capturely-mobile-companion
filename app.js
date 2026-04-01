/**
 * Capturely Remote - Mobile Peer logic
 * Connects to the desktop extension via PeerJS and streams the mobile screen.
 * v1.2 - Added expanded STUN/ICE config and detailed connection troubleshooting.
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
  const CONNECT_TIMEOUT_MS = 20000; // Increased timeout for NAT discovery

  function log(msg, error = false) {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement('div');
    if (error) div.style.color = '#ff7777';
    else if (msg.includes('ICE')) div.style.color = '#77aaff'; // Highlight ICE events
    else div.style.color = '#aaa';
    
    div.textContent = `[${time}] ${msg}`;
    logConsole.appendChild(div);
    logConsole.scrollTop = logConsole.scrollHeight;
    console.log(`[Capturely:Mobile] ${msg}`);
  }

  log('Application initialized v1.2');

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

    // Explicitly set the PeerJS cloud server
    peer = new Peer(undefined, {
      host: '0.peerjs.com',
      secure: true,
      port: 443,
      path: '/',
      pingInterval: 5000,
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.voipstunt.com:3478' },
          // --- Add TURN credentials here if needed ---
          // { urls: "turn:your-turn-server.com:3478", username: "user", credential: "password" }
        ],
        iceTransportPolicy: 'all',
      }
    });

    peer.on('open', (id) => {
      log(`My peer ID is: ${id}`);
      statusDisplay.textContent = 'Connecting...';
      statusDisplay.style.color = '#f0a030';
      connectToDesktop();
    });

    peer.on('error', (err) => {
      let msg = err.type;
      if (err.type === 'peer-unavailable') msg = 'Desktop not found. Ensure extension is open.';
      if (err.type === 'network') msg = 'Network error: Check firewall.';
      if (err.type === 'webrtc') msg = 'WebRTC error: NAT traversal failed.';

      log(`Peer error: ${msg}`, true);
      statusDisplay.textContent = msg;
      statusDisplay.style.color = '#ff4444';

      if (err.type === 'peer-unavailable' && connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        log(`Retry ${connectionRetries}/${MAX_RETRIES} in 3s...`);
        setTimeout(() => initPeer(), 3000);
      }
    });

    peer.on('disconnected', () => {
      log('Disconnected from signaling server.', true);
      if (peer && !peer.destroyed && peer.disconnected) {
        peer.reconnect();
      }
    });
  }

  function connectToDesktop() {
    log(`Connecting to desktop: ${desktopPeerId}...`);

    const connectTimer = setTimeout(() => {
      if (!dataConn || !dataConn.open) {
        log('Data connection timed out. Handshake missing.', true);
        log('TIP: Try a different network or check if desktop is on same WiFi.', false);
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          setTimeout(() => connectToDesktop(), 2000);
        }
      }
    }, CONNECT_TIMEOUT_MS);

    dataConn = peer.connect(desktopPeerId, { reliable: true });

    // Diagnostic: Track ICE candidates
    dataConn.on('iceStateChanged', (state) => {
      log(`ICE State: ${state}`);
    });

    dataConn.on('open', () => {
      clearTimeout(connectTimer);
      log('Data channel OPEN. Waiting for ACK...');
      statusDisplay.textContent = 'Handshaking...';
      statusDisplay.style.color = '#30d060';
    });

    dataConn.on('data', (data) => {
      log(`Data: ${JSON.stringify(data)}`);
      if (data && data.type === 'PAIRED') {
        log('Desktop paired!');
        statusDisplay.textContent = 'Ready to stream';
        statusDisplay.style.color = '#30d060';
        btnShare.classList.remove('hidden');
      }
    });
    
    dataConn.on('close', () => {
      log('Connection closed.', true);
      statusDisplay.textContent = 'Closed.';
      btnShare.classList.add('hidden');
    });
  }

  // 3. Handle Screen Sharing
  btnShare.addEventListener('click', async () => {
    try {
      log('Requesting screen share...');
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      log('Stream obtained. Calling desktop...');
      mediaConnection = peer.call(desktopPeerId, localStream);

      mediaConnection.on('error', (err) => log(`Media error: ${err.message}`, true));
      
      setupView.classList.add('hidden');
      streamingView.classList.remove('hidden');

      localStream.getVideoTracks()[0].onended = () => {
        log('Stream ended by system.');
        stopStreaming();
      };

    } catch (err) {
      log(`Stream failed: ${err.name}`, true);
      alert('Error: ' + err.message);
    }
  });

  btnStop.addEventListener('click', stopStreaming);

  function stopStreaming() {
    log('Stopping.');
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
