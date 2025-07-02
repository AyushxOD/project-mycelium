import React, { useState, useEffect, useRef } from 'react';
import init, { encode, decode } from 'mycelium-core';
import Peer from 'peerjs';
import { db, addPackets, getPacketsForFile, countPackets, addFileMetadata, getLatestFile, clearAllData } from './db';
import './App.css';

function App() {
  // Core App State
  const [log, setLog] = useState('System standby. Initializing Core...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWasmReady, setWasmReady] = useState(false);
  
  // P2P State
  const peerRef = useRef(null); // Use a ref for the peer object to ensure it's stable across re-renders
  const [myPeerId, setMyPeerId] = useState(null);
  const [conn, setConn] = useState(null);
  const [remotePeerId, setRemotePeerId] = useState('');
  const [p2pStatus, setP2pStatus] = useState('OFFLINE'); // OFFLINE, ONLINE, CONNECTING, PENDING_APPROVAL, CONNECTED
  const [pendingConn, setPendingConn] = useState(null);

  // File & Chat State
  const [reconstructionData, setReconstructionData] = useState(null);
  const fileInputRef = useRef(null);
  const [sharedSecret, setSharedSecret] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [pendingMessage, setPendingMessage] = useState(null);
  const messageHistoryRef = useRef(null);
  
  // Persistence State
  const [storedPacketCount, setStoredPacketCount] = useState(0);

  const appendLog = msg => setLog(prev => `${prev}\n> ${msg}`);

  const updatePacketCount = async () => {
    const count = await countPackets();
    setStoredPacketCount(count);
  };

  // This helper function attaches all necessary event listeners to a new connection object.
  const setupEventListeners = (newConn) => {
    newConn.on('data', (data) => handleIncomingData(data, newConn));
    newConn.on('close', () => {
      appendLog(`Connection to ${newConn.peer} closed.`);
      setP2pStatus('ONLINE');
      setConn(null);
    });
    newConn.on('error', (err) => {
        appendLog(`Connection Error: ${err.message}`);
        setP2pStatus('ONLINE');
    });
  };
  
  // Initialize WASM, PeerJS, and DB on component mount
  useEffect(() => {
    (async () => {
      try {
        await init();
        setWasmReady(true);
        appendLog('Mycelium Core with RaptorQ Engine is online.');
        
        await updatePacketCount();
        const lastFile = await getLatestFile();
        if (lastFile) {
            appendLog(`Loaded metadata for last known file: ${lastFile.fileName}`);
            setReconstructionData(lastFile);
        }
        
        let savedPeerId = localStorage.getItem('mycelium-peer-id');
        if (savedPeerId) {
            appendLog(`Found existing Peer ID: ${savedPeerId}`);
        } else {
            appendLog('No existing Peer ID found. A new one will be generated.');
            savedPeerId = undefined;
        }

        const peerInstance = new Peer(savedPeerId);
        peerRef.current = peerInstance; // Store the instance in a ref

        peerInstance.on('open', id => {
          appendLog(`P2P Network is Online. Your permanent Peer ID is: ${id}`);
          localStorage.setItem('mycelium-peer-id', id);
          setMyPeerId(id);
          setP2pStatus('ONLINE');
        });
        
        peerInstance.on('connection', newConn => {
          if (pendingConn || conn) { newConn.close(); return; }
          appendLog(`Incoming connection request from ${newConn.peer}`);
          setPendingConn(newConn);
          setP2pStatus('PENDING_APPROVAL');
        });

        peerInstance.on('error', err => {
            if (err.type === 'unavailable-id') {
                appendLog(`Peer ID '${savedPeerId}' is already in use. Resetting identity...`);
                handleResetIdentity();
            } else {
                appendLog(`P2P ERROR: ${err.type}: ${err.message}`);
            }
        });
      } catch (e) { appendLog(`FATAL ERROR initializing: ${String(e)}`); }
    })();
    
    // Cleanup function to destroy the peer connection on unmount
    return () => { 
        if (peerRef.current) {
            peerRef.current.destroy();
        }
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // Effect to process a pending message once the secret is entered
  useEffect(() => {
    if (pendingMessage && sharedSecret) {
      appendLog('Shared secret entered. Attempting to decrypt pending message...');
      handleIncomingData(pendingMessage.data, pendingMessage.conn);
      setPendingMessage(null);
    }
  }, [sharedSecret, pendingMessage]);

  // Auto-scroll message history
  useEffect(() => {
    if (messageHistoryRef.current) messageHistoryRef.current.scrollTop = messageHistoryRef.current.scrollHeight;
  }, [messages]);

  // --- CONNECTION MANAGEMENT ---
  const handleConnectToPeer = (e) => {
    e.preventDefault();
    if (!peerRef.current || !remotePeerId) return;
    appendLog(`Sending connection request to: ${remotePeerId}`);
    const newConn = peerRef.current.connect(remotePeerId, { reliable: true });
    setP2pStatus('CONNECTING');
    
    newConn.on('open', () => {
        appendLog(`Connection to ${newConn.peer} established and open.`);
        setP2pStatus('CONNECTED');
    });

    setupEventListeners(newConn);
    setConn(newConn);
  };
  
  const handleAcceptConnection = () => {
    const newConn = pendingConn;
    if (!newConn) return;
    
    appendLog(`Accepting connection from ${newConn.peer}...`);
    setupEventListeners(newConn);
    
    setConn(newConn);
    setP2pStatus('CONNECTED');
    setRemotePeerId(newConn.peer);
    setPendingConn(null);
  };

  const handleDeclineConnection = () => {
    if (!pendingConn) return;
    appendLog(`Declining connection from ${pendingConn.peer}.`);
    pendingConn.close();
    setPendingConn(null);
    setP2pStatus('ONLINE');
  };

  // --- DATA ROUTER ---
  const handleIncomingData = async (data, connection) => {
    const peerId = connection.peer;
    if (data.type === 'mycelium-file-data') {
      appendLog(`Receiving file data for '${data.fileName}' from peer.`);
      const { fileId, packets, oti, fileName, fileType } = data;
      const metadata = { fileId, oti, fileName, fileType };
      
      await addFileMetadata(metadata);
      await addPackets(fileId, packets);
      await updatePacketCount();
      
      appendLog(`Successfully stored metadata and ${packets.length} packets to local IndexedDB.`);
      setReconstructionData(metadata);
    } 
    else if (data.type === 'encrypted-message') {
      if (!sharedSecret) {
        appendLog('Received an encrypted message. Please enter the shared secret to decrypt.');
        setPendingMessage({data, conn: connection});
        return;
      }
      try {
        const key = await deriveKey(sharedSecret);
        const decrypted = await decryptMessage(key, data.iv, data.ciphertext);
        setMessages(prev => [...prev, { peer: peerId, text: decrypted, type: 'received' }]);
      } catch (e) {
        appendLog(`Failed to decrypt message. The shared secret may be incorrect.`);
      }
    }
  };
  
  // --- E2EE CHAT LOGIC ---
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
    if (p2pStatus !== 'CONNECTED' || !conn || !newMessage || !sharedSecret) return;
    try {
      const key = await deriveKey(sharedSecret);
      const { iv, ciphertext } = await encryptMessage(key, newMessage);
      conn.send({ type: 'encrypted-message', iv, ciphertext });
      setMessages(prev => [...prev, { peer: 'You', text: newMessage, type: 'sent' }]);
      setNewMessage('');
    } catch (e) { appendLog(`Message encryption failed: ${String(e)}`); }
  };

  // --- FILE PROCESSING LOGIC ---
  const processFile = async (file) => {
    if (!file || !isWasmReady) return;
    setIsProcessing(true); setReconstructionData(null);
    try {
      appendLog(`File received: ${file.name}`);
      const buf = new Uint8Array(await file.arrayBuffer());
      appendLog('Engaging RaptorQ encoding core...');
      const result = await encode(buf);
      appendLog(`Encoding complete. Generated ${result.packets.length} packets.`);
      
      const fileId = `file_${Date.now()}`;
      appendLog(`Assigned File ID: ${fileId}`);
      
      const metadata = { fileId, oti: result.oti, fileName: file.name, fileType: file.type };
      await addFileMetadata(metadata);
      await addPackets(fileId, result.packets);
      await updatePacketCount();
      appendLog(`Stored metadata and ${result.packets.length} packets to your local IndexedDB.`);

      const payload = { type: 'mycelium-file-data', ...metadata, packets: result.packets };
      setReconstructionData(metadata);

      if (conn && p2pStatus === 'CONNECTED') {
        appendLog(`Sending file data to peer: ${conn.peer}`);
        conn.send(payload);
      } else { appendLog('Not connected. Data stored locally only.'); }
    } catch (e) { appendLog(`ERROR: ${String(e)}`); }
    finally { setIsProcessing(false); }
  };
  
  const reconstructFile = async () => {
    if (!reconstructionData || !reconstructionData.fileId) { appendLog('No file loaded to reconstruct.'); return; }
    setIsProcessing(true);
    try {
      const { fileId, oti, fileName, fileType } = reconstructionData;
      appendLog(`Attempting reconstruction for '${fileName}' (ID: ${fileId})`);
      appendLog('Fetching required packets from local IndexedDB...');
      
      const storedPackets = await getPacketsForFile(fileId);
      if (storedPackets.length === 0) throw new Error("No packets found in database for this file.");
      
      appendLog(`Found ${storedPackets.length} packets. Decoding...`);
      const payload = { oti, packets: storedPackets };
      const data = await decode(payload);
      
      appendLog('Reconstruction SUCCEEDED! Preparing download…');
      const blob = new Blob([data], { type: fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `recovered_${fileName}`; a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { appendLog(`RECONSTRUCTION FAILED: ${String(e)}`); }
    finally { setIsProcessing(false); }
  };

  const handleClearStorage = async () => {
    appendLog("Clearing all packets and file metadata from local IndexedDB...");
    await clearAllData();
    await updatePacketCount();
    setReconstructionData(null);
    appendLog("Local storage cleared.");
  };

  const handleResetIdentity = () => {
      appendLog("Clearing permanent Peer ID and reloading...");
      localStorage.removeItem('mycelium-peer-id');
      window.location.reload();
  };

  return (
    <div className="container">
      <h1>&gt; PROJECT MYCELIUM_</h1>
      <h3>// P2P STATUS: {p2pStatus} // DB: {storedPacketCount} packets //</h3>
      {myPeerId && <h4>Your Peer ID: <span style={{color: '#ffff00', cursor: 'pointer'}} title="Click to copy" onClick={() => navigator.clipboard.writeText(myPeerId)}>{myPeerId}</span></h4>}

      {p2pStatus === 'PENDING_APPROVAL' && pendingConn && (
        <div className="popup">
          <p>Incoming connection request from: {pendingConn.peer}</p>
          <div className="button-group">
            <button onClick={handleAcceptConnection}>Accept</button>
            <button onClick={handleDeclineConnection} style={{background: '#555'}}>Decline</button>
          </div>
        </div>
      )}

      {p2pStatus === 'CONNECTING' && (
        <div className="popup"><p>Connection request sent... Waiting for acceptance.</p></div>
      )}
      
      {p2pStatus === 'CONNECTED' && (
         <div className="popup" style={{borderColor: '#00ff41'}}><p>Connection established with {remotePeerId}!</p></div>
      )}

      {(p2pStatus === 'ONLINE') && (
        <form onSubmit={handleConnectToPeer} className="p2p-form">
          <input type="text" placeholder="Enter remote Peer ID to connect" value={remotePeerId} onChange={e => setRemotePeerId(e.target.value)} disabled={!myPeerId}/>
          <button type="submit" disabled={!myPeerId || !remotePeerId}>Connect</button>
        </form>
      )}
      
      <div className="button-group">
         <input type="file" style={{ display: 'none' }} id="file-upload" ref={fileInputRef} onChange={e => processFile(e.target.files[0])} disabled={!isWasmReady}/>
         <button onClick={() => fileInputRef.current.click()} disabled={!isWasmReady || isProcessing}>Load & Send File</button>
        <button disabled={!reconstructionData || isProcessing} onClick={reconstructFile}>Reconstruct File from DB</button>
      </div>
      
      <div className="button-group">
          <button onClick={handleClearStorage} style={{background: '#555', flexGrow: 1}}>Clear Packet Storage</button>
          <button onClick={handleResetIdentity} style={{background: '#a50000', flexGrow: 1, color: '#fff'}}>Generate New Identity</button>
      </div>

      <div className="messaging-container">
        <h3>&gt; SECURE MESSAGING_</h3>
        <div className="p2p-form">
            <input type="password" placeholder="Enter a Shared Secret for E2EE Chat" value={sharedSecret} onChange={e => setSharedSecret(e.target.value)} />
        </div>
        <textarea placeholder="Type an encrypted message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} disabled={p2pStatus !== 'CONNECTED' || !sharedSecret}></textarea>
        <div className="button-group">
            <button onClick={handleSendMessage} disabled={p2pStatus !== 'CONNECTED' || !sharedSecret || !newMessage}>Send Encrypted Message</button>
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
