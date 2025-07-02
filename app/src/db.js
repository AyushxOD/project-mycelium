import Dexie from 'dexie';

export const db = new Dexie('mycelium_storage');

// Define the database schema (our tables)
db.version(2).stores({
  // 'packets' table stores individual data shards
  packets: '++id, fileId',
  // NEW 'files' table to store metadata for reconstruction
  files: 'fileId', 
});

// --- FILE METADATA HELPERS ---
export const addFileMetadata = async (metadata) => {
  return db.files.put(metadata);
};

export const getFileMetadata = async (fileId) => {
  return db.files.get(fileId);
};

export const getLatestFile = async () => {
    // Get the last file added to the DB to enable reconstruction on startup
    const lastFile = await db.files.orderBy('fileId').last();
    return lastFile;
};

// --- PACKET HELPERS ---
export const addPackets = async (fileId, packets) => {
  const packetsToAdd = packets.map(p => ({
    fileId,
    ...p
  }));
  return db.packets.bulkAdd(packetsToAdd);
};

export const getPacketsForFile = async (fileId) => {
  return db.packets.where({ fileId }).toArray();
};

export const countPackets = async () => {
  return db.packets.count();
};

// --- CLEAR ALL DATA ---
export const clearAllData = async () => {
  // Clear both tables
  await Promise.all([
      db.packets.clear(),
      db.files.clear()
  ]);
};
