import React, { useState, useEffect, useRef } from 'react';
import init, { encode, decode } from 'mycelium-core';
import Peer from 'peerjs';
import './App.css';

function App() {
  const [log, setLog] = useState('System standby. Core online.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWasmReady, setWasmReady] = useState(false);
  const [reconstructionData, setReconstructionData] = useState(null);

  // --- P2P State ---
  const [peer, setPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState(null);
  const [conn, setConn] = useState(null);
  const [remotePeerId, setRemotePeerId] = useState('');
  const [isP2pConnected, setIsP2pConnected] = useState(false);
  const [pendingConn, setPendingConn] = useState(null);

  // --- Encrypted Messaging State ---
  const [sharedSecret, setSharedSecret] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [pendingMessage, setPendingMessage] = useState(null);
  
  const fileInputRef = useRef(null);
  const messageHistoryRef = useRef(null);
  
  const appendLog = msg => setLog(prev => `${prev}\n> ${msg}`);

  // This new helper function is the key to the fix.
  // It attaches all necessary event listeners to a new connection.
  const setupConnectionListeners = (newConn) => {
    newConn.on('data', (data) => handleIncomingData(data));
    newConn.on('close', () => {
      appendLog(`Connection to ${newConn.peer} closed.`);
      setConn(null);
      setIsP2pConnected(false);
    });
    newConn.on('error', (err) => {
      appendLog(`Connection Error: ${err.message}`);
    });
  };
  
  // Initialize WASM and PeerJS
  useEffect(() => {
    (async () => {
      try {
        await init();
        setWasmReady(true);
        appendLog('Mycelium Core with RaptorQ Engine is online.');
        
        const newPeer = new Peer();
        setPeer(newPeer);

        newPeer.on('open', id => {
          appendLog(`P2P Network Connection Open. Your Peer ID is: ${id}`);
          setMyPeerId(id);
        });
        
        newPeer.on('connection', newConn => {
          appendLog(`Incoming connection request from ${newConn.peer}`);
          setPendingConn(newConn);
        });

        newPeer.on('error', err => appendLog(`P2P ERROR: ${err.type}: ${err.message}`));
      } catch (e) { appendLog(`FATAL ERROR initializing: ${String(e)}`); }
    })();
    return () => { if (peer) peer.destroy(); };
  }, []);

  // Decrypts a pending message if the secret is entered
  useEffect(() => {
    if (pendingMessage && sharedSecret) {
      appendLog('Shared secret entered. Attempting to decrypt pending message...');
      handleIncomingData(pendingMessage);
      setPendingMessage(null);
    }
  }, [sharedSecret, pendingMessage]);

  // Auto-scroll message history
  useEffect(() => {
    if (messageHistoryRef.current) {
      messageHistoryRef.current.scrollTop = messageHistoryRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAcceptConnection = () => {
    const newConn = pendingConn;
    if (!newConn) return;
    
    appendLog(`Accepting connection from ${newConn.peer}...`);
    setupConnectionListeners(newConn);
    
    // For the receiver, the connection is ready immediately.
    setConn(newConn);
    setIsP2pConnected(true);
    setRemotePeerId(newConn.peer);
    setPendingConn(null);
  };


  const handleDeclineConnection = () => {
    appendLog(`Declining connection from ${pendingConn.peer}.`);
    pendingConn.close();
    setPendingConn(null);
  };

  const handleConnectToPeer = (e) => {
    e.preventDefault();
    if (!peer || !remotePeerId) return;

    appendLog(`Attempting to connect to Peer ID: ${remotePeerId}`);
    const newConn = peer.connect(remotePeerId, { reliable: true });
    
    // For the initiator, we wait for the 'open' event.
    newConn.on('open', () => {
        appendLog(`Connection to ${newConn.peer} established and open.`);
        setIsP2pConnected(true);
    });

    setupConnectionListeners(newConn);
    setConn(newConn);
  };


  const handleIncomingData = async (data) => {
    if (data.type === 'mycelium-file-data') {
      appendLog(`Receiving file data for '${data.fileName}' from peer.`);
      setReconstructionData({ oti: data.oti, packets: data.packets, fileName: data.fileName, fileType: data.fileType });
    } 
    else if (data.type === 'encrypted-message') {
      if (!sharedSecret) {
        appendLog('Received an encrypted message. Please enter the shared secret to decrypt.');
        setPendingMessage(data);
        return;
      }
      try {
        const key = await deriveKey(sharedSecret);
        const decrypted = await decryptMessage(key, data.iv, data.ciphertext);
        setMessages(prev => [...prev, { peer: conn.peer, text: decrypted, type: 'received' }]);
      } catch (e) {
        appendLog(`Failed to decrypt message. The shared secret may be incorrect.`);
      }
    }
  };
  
  const deriveKey = (secret) => {
    const encoder = new TextEncoder();
    return window.crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey'])
      .then(baseKey => window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: encoder.encode("mycelium-salt"), iterations: 100000, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
      ));
  };
  const encryptMessage = async (key, text) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { iv, ciphertext };
  };
  const decryptMessage = async (key, iv, ciphertext) => {
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  };
  
  const handleSendMessage = async () => {
    if (!conn || !conn.open || !newMessage || !sharedSecret) {
      appendLog("Cannot send message. Ensure you are connected and have set a shared secret.");
      return;
    }
    try {
      const key = await deriveKey(sharedSecret);
      const { iv, ciphertext } = await encryptMessage(key, newMessage);
      conn.send({ type: 'encrypted-message', iv, ciphertext });
      setMessages(prev => [...prev, { peer: 'You', text: newMessage, type: 'sent' }]);
      setNewMessage('');
    } catch (e) { appendLog(`Message encryption failed: ${String(e)}`); }
  };

  const processFile = async (file) => {
    if (!file || !isWasmReady) return;
    setIsProcessing(true);
    setReconstructionData(null);
    try {
      appendLog(`File received: ${file.name}`);
      const buf = new Uint8Array(await file.arrayBuffer());
      appendLog('Engaging RaptorQ encoding core...');
      const result = await encode(buf);
      appendLog(`Encoding complete. Generated ${result.packets.length} packets.`);
      
      const payload = {
        type: 'mycelium-file-data',
        oti: result.oti,
        packets: result.packets,
        fileName: file.name,
        fileType: file.type,
      };
      setReconstructionData(payload);

      if (conn && conn.open) {
        appendLog(`Sending file data to peer: ${conn.peer}`);
        conn.send(payload);
      } else {
        appendLog('Not connected to a peer. Data stored locally.');
      }
    } catch (e) {
      appendLog(`ERROR: ${String(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const reconstructFile = async () => {
    if (!reconstructionData) {
      appendLog('No file data available.');
      return;
    }
    setIsProcessing(true);
    try {
      appendLog('Simulating data loss and attempting reconstruction...');
      const totalPackets = reconstructionData.packets.length;
      const subsetToKeep = Math.ceil(totalPackets * 0.6);
      const survivingPackets = [...reconstructionData.packets].sort(() => 0.5 - Math.random()).slice(0, subsetToKeep);
      appendLog(`Using ${survivingPackets.length} of ${totalPackets} packets for reconstruction.`);

      const payload = { oti: reconstructionData.oti, packets: survivingPackets };
      const data = await decode(payload);
      appendLog('Reconstruction SUCCEEDED! Preparing download…');
      const blob = new Blob([data], { type: reconstructionData.fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recovered_${reconstructionData.fileName}`;
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      appendLog(`RECONSTRUCTION FAILED: ${String(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="container">
      <h1>&gt; PROJECT MYCELIUM_</h1>
      <h3>// P2P STATUS: {myPeerId ? (isP2pConnected ? `CONNECTED` : 'ONLINE') : 'OFFLINE'} //</h3>
      {myPeerId && <h4>Your Peer ID: <span style={{color: '#ffff00'}}>{myPeerId}</span></h4>}

      {pendingConn && (
        <div className="connection-request">
          <p>Incoming connection from: {pendingConn.peer}</p>
          <div className="button-group">
            <button onClick={handleAcceptConnection}>Accept</button>
            <button onClick={handleDeclineConnection} style={{background: '#555'}}>Decline</button>
          </div>
        </div>
      )}

      <form onSubmit={handleConnectToPeer} className="p2p-form">
        <input type="text" placeholder="Enter remote Peer ID" value={remotePeerId} onChange={e => setRemotePeerId(e.target.value)} disabled={!myPeerId || isP2pConnected}/>
        <button type="submit" disabled={!myPeerId || !remotePeerId || isP2pConnected}>{isP2pConnected ? 'Connected' : 'Connect'}</button>
      </form>
      
      <div className="button-group">
         <input type="file" style={{ display: 'none' }} id="file-upload" ref={fileInputRef} onChange={e => processFile(e.target.files[0])} disabled={!isWasmReady}/>
         <button onClick={() => fileInputRef.current.click()} disabled={!isWasmReady || isProcessing}>
           Load & Send File
         </button>
        <button disabled={!reconstructionData || isProcessing} onClick={reconstructFile}>
          Simulate Loss & Reconstruct
        </button>
      </div>

      <div className="messaging-container">
        <h3>&gt; SECURE MESSAGING_</h3>
        <div className="p2p-form">
            <input type="password" placeholder="Enter a Shared Secret for E2EE Chat" value={sharedSecret} onChange={e => setSharedSecret(e.target.value)} />
        </div>
        <textarea placeholder="Type an encrypted message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} disabled={!isP2pConnected || !sharedSecret}></textarea>
        <div className="button-group">
            <button onClick={handleSendMessage} disabled={!isP2pConnected || !sharedSecret || !newMessage}>Send Encrypted Message</button>
        </div>
        <div className="message-history" ref={messageHistoryRef}>
            {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.type}`}><strong>{msg.peer}:</strong> {msg.text}</div>
            ))}
        </div>
      </div>
      
      <h3>&gt; SYSTEM LOG_</h3>
      <pre id="log">{log}</pre>
    </div>
  );
}

export default App;