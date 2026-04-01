/**
 * Capturely Remote - Mobile Peer logic
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
  let mediaConnection = null;
  let localStream = null;

  // 1. Get Desktop Peer ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  desktopPeerId = urlParams.get('id');

  if (!desktopPeerId) {
    statusDisplay.textContent = 'Error: No pairing ID provided.';
    return;
  }

  // 2. Initialize PeerJS
  peer = new Peer();

  peer.on('open', (id) => {
    console.log('My peer ID is: ' + id);
    statusDisplay.textContent = 'Connecting to desktop...';
    
    // Auto-initiate connection
    connectToDesktop();
  });

  peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    statusDisplay.textContent = 'Error: ' + err.type;
  });

  function connectToDesktop() {
    const conn = peer.connect(desktopPeerId);
    conn.on('open', () => {
      console.log('Connected to desktop peer!');
      statusDisplay.textContent = 'Ready to stream';
      btnShare.classList.remove('hidden');
    });
    
    conn.on('close', () => {
      statusDisplay.textContent = 'Connection closed. Please refresh.';
      btnShare.classList.add('hidden');
    });
  }

  // 3. Handle Screen Sharing
  btnShare.addEventListener('click', async () => {
    try {
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

      console.log('Started local stream:', localStream);
      
      // Call the desktop with our screen stream
      mediaConnection = peer.call(desktopPeerId, localStream);
      
      setupView.classList.add('hidden');
      streamingView.classList.remove('hidden');

      // If the user stops via the native OS UI
      localStream.getVideoTracks()[0].onended = () => {
        stopStreaming();
      };

    } catch (err) {
      console.error('Failed to get stream:', err);
      alert('Could not start screen share: ' + err.message);
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
  }

})();
