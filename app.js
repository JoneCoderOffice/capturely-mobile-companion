/**
 * Capturely Remote - Mobile Peer logic
 * Connects to the desktop extension via PeerJS and streams the mobile screen.
 * v1.3 - Support for custom signaling servers and heartbeats.
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
  let heartbeatInterval = null;
  const MAX_RETRIES = 5;
  const CONNECT_TIMEOUT_MS = 25000; // Increased to 25s for slow NAT traversal

  function log(msg, error = false) {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement('div');
    if (error) div.style.color = '#ff7777';
    else if (typeof msg === 'string' && msg.includes('ICE')) div.style.color = '#77aaff';
    else if (typeof msg === 'string' && msg.includes('Heartbeat')) div.style.color = '#77ffaa';
    else div.style.color = '#aaa';
    
    const displayMsg = (typeof msg === 'object') ? JSON.stringify(msg, (key, value) => {
      if (key === 'peerConnection' || key === 'provider') return '[Circular]';
      return value;
    }, 2) : String(msg);

    div.textContent = `[${time}] ${displayMsg}`;
    logConsole.appendChild(div);
    logConsole.scrollTop = logConsole.scrollHeight;
    console.log(`[Capturely:Mobile] ${msg}`);
  }

  log('Application initialized v1.3');

  // 1. Parse Desktop ID and Signaling Params from URL
  const urlParams = new URLSearchParams(window.location.search);
  desktopPeerId = urlParams.get('id');
  
  // Custom signaling params
  const sigConfig = {
    host: urlParams.get('host') || '0.peerjs.com',
    port: parseInt(urlParams.get('port')) || 443,
    path: urlParams.get('p') || '/',
    secure: urlParams.get('s') !== '0'
  };

  if (!desktopPeerId) {
    log('Error: No pairing ID provided in URL.', true);
    statusDisplay.textContent = 'Error: No pairing ID provided.';
    statusDisplay.style.color = '#ff4444';
    return;
  }
  log(`Desktop ID: ${desktopPeerId}`);
  log(`Signaling: ${sigConfig.host}:${sigConfig.port}${sigConfig.path} (secure: ${sigConfig.secure})`);

  // 2. Initialize PeerJS
  function initPeer() {
    log(`Connecting to signaling server ${sigConfig.host}...`);
    if (peer) {
      peer.destroy();
    }

    peer = new Peer(undefined, {
      host: sigConfig.host,
      port: sigConfig.port,
      path: sigConfig.path,
      secure: sigConfig.secure,
      pingInterval: 5000,
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          // --- Public TURN relay (OpenRelayProject) ---
          {
            urls: [
              'turn:openrelay.metered.ca:80',
              'turn:openrelay.metered.ca:443',
              'turn:openrelay.metered.ca:443?transport=tcp'
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ],
        iceTransportPolicy: 'all',
      }
    });

    peer.on('open', (id) => {
      log(`My peer ID is: ${id}`);
      statusDisplay.textContent = 'Connecting to desktop...';
      statusDisplay.style.color = '#f0a030';
      connectToDesktop();
    });

    peer.on('error', (err) => {
      let msg = err.type;
      if (err.type === 'peer-unavailable') msg = 'Desktop not found. Ensure extension is open.';
      if (err.type === 'network') msg = 'Signaling server unreachable.';
      if (err.type === 'webrtc') msg = 'NAT traversal failed.';

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
    log(`P2P Handshake with: ${desktopPeerId}...`);

    const connectTimer = setTimeout(() => {
      if (!dataConn || !dataConn.open) {
        log('P2P connection timed out.', true);
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          setTimeout(() => connectToDesktop(), 2000);
        }
      }
    }, CONNECT_TIMEOUT_MS);

    dataConn = peer.connect(desktopPeerId, { reliable: true });
    log(`Connecting to: ${desktopPeerId}`);

    dataConn.on('open', () => {
      clearTimeout(connectTimer);
      connectionRetries = 0; // Reset counter on success
      log('P2P channel OPEN. Waiting for ACK...');
      statusDisplay.textContent = 'Handshaking...';
      statusDisplay.style.color = '#30d060';
      
      // Monitor ICE connection state changes for diagnostic log
      if (dataConn.peerConnection) {
        const pc = dataConn.peerConnection;
        log(`ICE Connection State: ${pc.iceConnectionState}`);
        pc.oniceconnectionstatechange = () => {
          log(`ICE Connection State: ${pc.iceConnectionState}`);
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            const stats = pc.getStats().then(s => {
              s.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                  const relayUsed = report.remoteCandidateType === 'relay' || report.localCandidateType === 'relay';
                  log(`Connection Type: ${relayUsed ? 'Relay (TURN)' : 'Direct (P2P)'}`);
                }
              });
            });
          }
          if (pc.iceConnectionState === 'failed') {
            log('ICE traversal failed. Please check network restrictions.', true);
          }
        };
      }
      
      // Start heartbeat
      startHeartbeat();
    });

    dataConn.on('data', (data) => {
      if (data && data.type === 'PAIRED') {
        log('Desktop paired!');
        statusDisplay.textContent = 'Ready to stream';
        statusDisplay.style.color = '#30d060';
        btnShare.classList.remove('hidden');
      }
      if (data && data.type === 'PONG') {
        // Quiet heartbeat log
        console.log('[Capturely:Mobile] Pong received');
      }
    });
    
    dataConn.on('close', () => {
      log('Connection closed.', true);
      statusDisplay.textContent = 'Closed.';
      btnShare.classList.add('hidden');
      stopHeartbeat();
    });
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (dataConn && dataConn.open) {
        dataConn.send({ type: 'PING' });
      }
    }, 10000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
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
