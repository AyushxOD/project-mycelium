// app/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import init, { encode, decode } from 'mycelium-core';
import './App.css';

const INITIAL_NODES = [
  { id: 1, name: 'My-Laptop', online: true, packets: [] },
  { id: 2, name: 'Desktop-PC', online: true, packets: [] },
  { id: 3, name: 'Phone', online: true, packets: [] },
  { id: 4, name: 'Home-Server', online: true, packets: [] },
  { id: 5, name: 'Cloud-VM', online: true, packets: [] },
];

function App() {
  const [log, setLog] = useState('System standby. Please generate an encryption key to begin.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWasmReady, setWasmReady] = useState(false);
  const [reconstructionData, setReconstructionData] = useState(null);
  const fileInputRef = useRef(null);
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [cryptoKey, setCryptoKey] = useState(null);

  const appendLog = msg => setLog(prev => `${prev}\n> ${msg}`);

  useEffect(() => {
    (async () => {
      try {
        await init();
        setWasmReady(true);
        appendLog('Mycelium Core with RaptorQ Engine is online.');
      } catch (e) {
        appendLog(`FATAL ERROR initializing Core: ${String(e)}`);
      }
    })();
  }, []);

  useEffect(() => {
    const el = document.getElementById('log');
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const handleGenerateKey = async () => {
    try {
      appendLog('Generating new master encryption key (AES-GCM)...');
      const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      setCryptoKey(key);
      setReconstructionData(null);
      setNodes(INITIAL_NODES);
      appendLog('Master key generated. Ready to process files.');
    } catch (e) {
      appendLog(`Key generation failed: ${String(e)}`);
    }
  };

  const processFile = async file => {
    if (!file || !isWasmReady || !cryptoKey) {
      appendLog('ERROR: Please generate an encryption key first.');
      return;
    }
    setIsProcessing(true);
    setNodes(INITIAL_NODES);
    setReconstructionData(null);
    try {
      appendLog(`File received: ${file.name}`);
      const buf = new Uint8Array(await file.arrayBuffer());
      appendLog('Encrypting file with master key...');
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encryptedData = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, buf);
      appendLog('Engaging RaptorQ encoding core on encrypted data...');
      const result = await encode(new Uint8Array(encryptedData));
      appendLog(`Encoding complete. Generated ${result.packets.length} packets.`);
      appendLog('Distributing packets across virtual device network...');
      const updatedNodes = [...INITIAL_NODES];
      result.packets.forEach((packet, index) => {
        const nodeIndex = index % updatedNodes.length;
        updatedNodes[nodeIndex].packets.push(packet);
      });
      setNodes(updatedNodes);
      setReconstructionData({ oti: result.oti, fileName: file.name, fileType: file.type, iv: iv });
    } catch (e) {
      appendLog(`ERROR: ${String(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const reconstructFile = async () => {
    if (!reconstructionData) return;
    setIsProcessing(true);
    try {
      appendLog('Attempting reconstruction from device network...');
      const survivingPackets = nodes.reduce((acc, node) => {
        if (node.online) return [...acc, ...node.packets];
        return acc;
      }, []);
      appendLog(`Gathered ${survivingPackets.length} packets from all ONLINE nodes.`);
      const payload = { oti: reconstructionData.oti, packets: survivingPackets };
      const decodedEncryptedData = await decode(payload);
      appendLog('Reconstruction of encrypted data SUCCEEDED!');
      appendLog('Decrypting data with master key...');
      const decryptedData = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: reconstructionData.iv }, cryptoKey, decodedEncryptedData);
      appendLog('Decryption successful! Preparing download…');
      const blob = new Blob([decryptedData], { type: reconstructionData.fileType });
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

  const handleToggleNode = (nodeId) => {
    setNodes(currentNodes =>
      currentNodes.map(node => {
        if (node.id === nodeId) {
          const isNowOnline = !node.online;
          appendLog(`Node '${node.name}' is now ${isNowOnline ? 'ONLINE' : 'OFFLINE'}.`);
          return { ...node, online: isNowOnline };
        }
        return node;
      })
    );
  };

  return (
    <div className="container">
      <h1>&gt; PROJECT MYCELIUM_</h1>
      <h3>// SIMULATOR // CORE STATUS: {isWasmReady ? 'ONLINE' : 'INITIALIZING'} //</h3>
      <div className="button-group">
        <button disabled={!isWasmReady || isProcessing} onClick={handleGenerateKey}>
          Generate Encryption Key
        </button>
      </div>
      <h3>// E2EE STATUS: {cryptoKey ? 'MASTER KEY LOADED' : 'NO KEY'} //</h3>
      <input
        type="file"
        style={{ display: 'none' }}
        ref={fileInputRef}
        disabled={!isWasmReady || !cryptoKey || isProcessing}
        onChange={e => processFile(e.target.files[0])}
      />
      <div
        id="drop-zone"
        className={isWasmReady && cryptoKey ? 'active' : ''}
        onClick={() => isWasmReady && cryptoKey && !isProcessing && fileInputRef.current.click()}
      >
        {isWasmReady ? (cryptoKey ? (isProcessing ? 'Processing…' : 'Drop File or Click Here') : 'Generate Key to Begin') : 'Initializing…'}
      </div>
      <div className="button-group">
        <button disabled={!reconstructionData || !cryptoKey || isProcessing} onClick={reconstructFile}>
          Heal Network & Reconstruct File
        </button>
      </div>
      <h3>&gt; VIRTUAL DEVICE NETWORK_</h3>
      <div className="node-container">
        {nodes.map(node => (
          <div key={node.id} className={`node ${node.online ? 'online' : 'offline'}`}>
            <p>{node.name}</p>
            <span>{node.packets.length} packets stored</span>
            <button className="node-toggle" onClick={() => handleToggleNode(node.id)}>
              {node.online ? 'Take Offline' : 'Bring Online'}
            </button>
          </div>
        ))}
      </div>
      <h3>&gt; LOG_</h3>
      <pre id="log">{log}</pre>
    </div>
  );
}

export default App;