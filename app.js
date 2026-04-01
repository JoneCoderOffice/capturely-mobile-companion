/**
 * Capturely Remote - Mobile Peer logic
 * Connects to the desktop extension via PeerJS and streams the mobile screen.
 */

(function() {
  'use strict';

  const btnShare = document.getElementById('btnShare');
  const btnStop = document.getElementById('btnStop');
  const statusDisplay = document.getElementById('connectionStatus');
  const setupView = document.getElementById('setup');
  const streamingView = document.getElementById('streaming');

  let peer = null;
  let desktopPeerId = null;
  let dataConn = null;
  let mediaConnection = null;
  let localStream = null;
  let connectionRetries = 0;
  const MAX_RETRIES = 3;
  const CONNECT_TIMEOUT_MS = 10000; // 10 seconds

  // 1. Get Desktop Peer ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  desktopPeerId = urlParams.get('id');

  if (!desktopPeerId) {
    statusDisplay.textContent = 'Error: No pairing ID provided.';
    statusDisplay.style.color = '#ff4444';
    return;
  }

  // 2. Initialize PeerJS with explicit ICE config
  function initPeer() {
    if (peer) {
      peer.destroy();
    }

    peer = new Peer(undefined, {
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
      console.log('[Capturely:Mobile] My peer ID is:', id);
      statusDisplay.textContent = 'Connecting to desktop...';
      statusDisplay.style.color = '#f0a030';
      connectToDesktop();
    });

    peer.on('error', (err) => {
      console.error('[Capturely:Mobile] PeerJS error:', err.type, err);

      if (err.type === 'peer-unavailable') {
        statusDisplay.textContent = 'Desktop not found. Make sure the QR code is fresh.';
        statusDisplay.style.color = '#ff4444';
        // Retry with a fresh peer
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          statusDisplay.textContent = `Desktop not found. Retry ${connectionRetries}/${MAX_RETRIES}...`;
          setTimeout(() => initPeer(), 2000);
        }
      } else if (err.type === 'network') {
        statusDisplay.textContent = 'Network error. Check your internet connection.';
        statusDisplay.style.color = '#ff4444';
      } else if (err.type === 'browser-incompatible') {
        statusDisplay.textContent = 'This browser does not support WebRTC.';
        statusDisplay.style.color = '#ff4444';
      } else {
        statusDisplay.textContent = 'Connection error: ' + err.type;
        statusDisplay.style.color = '#ff4444';
      }
    });

    peer.on('disconnected', () => {
      console.warn('[Capturely:Mobile] Disconnected from signaling server.');
      statusDisplay.textContent = 'Disconnected. Reconnecting...';
      statusDisplay.style.color = '#f0a030';
      peer.reconnect();
    });
  }

  function connectToDesktop() {
    console.log('[Capturely:Mobile] Attempting data connection to:', desktopPeerId);

    // Set a timeout — if the connection doesn't open within CONNECT_TIMEOUT_MS, retry
    const connectTimer = setTimeout(() => {
      if (!dataConn || !dataConn.open) {
        console.warn('[Capturely:Mobile] Connection timed out.');
        if (connectionRetries < MAX_RETRIES) {
          connectionRetries++;
          statusDisplay.textContent = `Timeout. Retry ${connectionRetries}/${MAX_RETRIES}...`;
          statusDisplay.style.color = '#f0a030';
          setTimeout(() => connectToDesktop(), 1000);
        } else {
          statusDisplay.textContent = 'Could not connect. Refresh and try a new QR code.';
          statusDisplay.style.color = '#ff4444';
        }
      }
    }, CONNECT_TIMEOUT_MS);

    dataConn = peer.connect(desktopPeerId, { reliable: true });

    dataConn.on('open', () => {
      clearTimeout(connectTimer);
      console.log('[Capturely:Mobile] Data channel OPEN to desktop!');
      statusDisplay.textContent = 'Paired! Waiting for confirmation...';
      statusDisplay.style.color = '#30d060';
      connectionRetries = 0; // reset on success
    });

    dataConn.on('data', (data) => {
      console.log('[Capturely:Mobile] Data from desktop:', data);
      if (data && data.type === 'PAIRED') {
        statusDisplay.textContent = 'Ready to stream';
        statusDisplay.style.color = '#30d060';
        btnShare.classList.remove('hidden');
      }
    });
    
    dataConn.on('close', () => {
      console.log('[Capturely:Mobile] Data connection closed.');
      statusDisplay.textContent = 'Connection closed. Please refresh.';
      statusDisplay.style.color = '#ff4444';
      btnShare.classList.add('hidden');
    });

    dataConn.on('error', (err) => {
      clearTimeout(connectTimer);
      console.error('[Capturely:Mobile] Data connection error:', err);
      statusDisplay.textContent = 'Connection error. Please refresh.';
      statusDisplay.style.color = '#ff4444';
    });
  }

  // 3. Handle Screen Sharing
  btnShare.addEventListener('click', async () => {
    try {
      statusDisplay.textContent = 'Requesting screen access...';
      statusDisplay.style.color = '#f0a030';

      // iOS / Android getDisplayMedia call
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      console.log('[Capturely:Mobile] Screen stream obtained:', localStream.getTracks().map(t => `${t.kind}:${t.label}`));
      
      // Call the desktop with our screen stream
      mediaConnection = peer.call(desktopPeerId, localStream);

      mediaConnection.on('error', (err) => {
        console.error('[Capturely:Mobile] Media call error:', err);
        statusDisplay.textContent = 'Streaming error: ' + err.message;
        statusDisplay.style.color = '#ff4444';
      });
      
      setupView.classList.add('hidden');
      streamingView.classList.remove('hidden');

      // If the user stops via the native OS UI
      localStream.getVideoTracks()[0].onended = () => {
        stopStreaming();
      };

    } catch (err) {
      console.error('[Capturely:Mobile] Failed to get stream:', err);
      if (err.name === 'NotAllowedError') {
        statusDisplay.textContent = 'Screen share denied. Tap "Start Screen Share" to try again.';
      } else {
        statusDisplay.textContent = 'Could not start screen share: ' + err.message;
      }
      statusDisplay.style.color = '#ff4444';
    }
  });

  btnStop.addEventListener('click', () => {
    stopStreaming();
  });

  function stopStreaming() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    if (mediaConnection) {
      mediaConnection.close();
      mediaConnection = null;
    }
    setupView.classList.remove('hidden');
    streamingView.classList.add('hidden');
    statusDisplay.textContent = 'Streaming stopped. You can share again.';
    statusDisplay.style.color = '#30d060';
    btnShare.classList.remove('hidden');
  }

  // Start the connection flow
  initPeer();

})();
