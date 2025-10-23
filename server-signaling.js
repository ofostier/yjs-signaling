// server-signaling.js - Serveur y-websocket officiel
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createServer } from 'http';

const PORT = 1234;

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Y.js WebSocket Server\n');
});

const wss = new WebSocketServer({ server });

// Stockage des documents par room
const docs = new Map();
const conns = new Map();

console.log('\n🎯 ========================================');
console.log(`✅ Serveur Y.js WebSocket démarré`);
console.log(`📡 WebSocket: ws://localhost:${PORT}`);
console.log('🎯 ========================================\n');

const messageSync = 0;
const messageAwareness = 1;

wss.on('connection', (conn, req) => {
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  console.log(`\n🎯 ========================================`);
  console.log(`📡 [${timestamp}] NOUVELLE CONNEXION Y.js`);
  console.log(`🔗 URL complète: ${req.url}`);
  console.log(`🌐 Origin: ${req.headers.origin || 'N/A'}`);
  console.log(
    `📋 User-Agent: ${req.headers['user-agent']?.substring(0, 50) || 'N/A'}...`
  );

  const docName = req.url.slice(1).split('?')[0] || 'default';
  console.log(`📍 Room extraite: "${docName}"`);

  // Afficher combien de connexions sur cette room
  const roomConnections = Array.from(conns.values()).filter(
    (c) => c.docName === docName
  ).length;
  console.log(`👥 Connexions existantes dans cette room: ${roomConnections}`);

  // Lister toutes les rooms actives
  const allRooms = new Set();
  conns.forEach((c) => allRooms.add(c.docName));
  console.log(`🏠 Rooms actives: [${Array.from(allRooms).join(', ')}]`);

  conn.binaryType = 'arraybuffer';

  // Obtenir ou créer le document
  let doc = docs.get(docName);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(docName, doc);
    console.log(`🆕 Document créé: ${docName}`);
  }

  const awareness = new awarenessProtocol.Awareness(doc);

  // Stocker la connexion
  const connId = Math.random().toString(36).substring(2, 8);
  conns.set(connId, { conn, doc, awareness, docName, connectedAt: timestamp });
  console.log(`🆔 ID de connexion: ${connId}`);

  // Envoyer le sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  conn.send(encoding.toUint8Array(encoder));
  console.log(`📤 Sync Step 1 envoyé à ${connId} pour room "${docName}"`);

  // Envoyer l'awareness
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        Array.from(awarenessStates.keys())
      )
    );
    conn.send(encoding.toUint8Array(awarenessEncoder));
  }

  // Gérer les messages entrants
  conn.on('message', (message) => {
    try {
      const uint8Array = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8Array);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === messageSync) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder));
        }

        // Broadcaster aux autres
        let broadcastCount = 0;
        conns.forEach((c, id) => {
          if (
            id !== connId &&
            c.docName === docName &&
            c.conn.readyState === 1
          ) {
            c.conn.send(uint8Array);
            broadcastCount++;
          }
        });

        console.log(
          `📥 [${timestamp}] Sync message traité et diffusé à ${broadcastCount} connexion(s) dans "${docName}"`
        );
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );

        // Broadcaster awareness aux autres
        let awarenessbroadcastCount = 0;
        conns.forEach((c, id) => {
          if (
            id !== connId &&
            c.docName === docName &&
            c.conn.readyState === 1
          ) {
            c.conn.send(uint8Array);
            awarenessbroadcastCount++;
          }
        });

        console.log(
          `📤 Awareness diffusé à ${awarenessbroadcastCount} connexion(s) dans "${docName}"`
        );

        // ✅ DÉTAIL: Afficher les informations utilisateur avec plus de détails
        try {
          const awarenessStates = awareness.getStates();
          const users = [];
          const allUsers = [];

          awarenessStates.forEach((state, clientId) => {
            const userInfo = {
              id: clientId,
              connId: connId,
              name: state.user?.name || 'Anonymous',
              userName: state.user?.userName || 'N/A',
              color: state.user?.color || '#000000',
              hasCustomName: state.user?.hasCustomName || false,
              timestamp: state.user?.timestamp || 'N/A',
            };
            allUsers.push(userInfo);

            if (state.user) {
              users.push(userInfo);
            }
          });

          console.log(
            `\n👥 [${timestamp}] AWARENESS UPDATE - Room "${docName}"`
          );
          console.log(`📊 États awareness: ${awarenessStates.size} total`);

          if (users.length > 0) {
            console.log(`✅ Utilisateurs identifiés (${users.length}):`);
            users.forEach((user) => {
              console.log(`   🙋 ${user.name} (userName: ${user.userName})`);
              console.log(`      • ID: ${user.id} | ConnID: ${user.connId}`);
              console.log(`      • Couleur: ${user.color}`);
              console.log(`      • Nom personnalisé: ${user.hasCustomName}`);
            });
          }

          if (allUsers.length > users.length) {
            console.log(
              `⚠️  États sans utilisateur (${allUsers.length - users.length}):`
            );
            allUsers
              .filter((u) => !users.includes(u))
              .forEach((user) => {
                console.log(`   👻 ID: ${user.id} (pas d'info utilisateur)`);
              });
          }

          // Compter les connexions uniques dans cette room
          const roomConns = Array.from(conns.values()).filter(
            (c) => c.docName === docName
          );
          console.log(
            `🔗 Connexions WebSocket dans "${docName}": ${roomConns.length}`
          );
          console.log(`🎯 ========================================\n`);
        } catch (error) {
          console.log(
            `📥 Awareness update traité (erreur info utilisateur: ${error.message})`
          );
        }
      }
    } catch (err) {
      console.error('❌ Erreur:', err.message);
    }
  });

  conn.on('close', () => {
    const timestamp = new Date().toLocaleTimeString('fr-FR');
    console.log(`\n� ========================================`);
    console.log(`�📡 [${timestamp}] CONNEXION FERMÉE`);
    console.log(`🆔 ConnID: ${connId}`);
    console.log(`📍 Room: "${docName}"`);

    conns.delete(connId);
    awareness.destroy();

    // Compter les connexions restantes
    const remainingConnections = Array.from(conns.values()).filter(
      (c) => c.docName === docName
    ).length;
    console.log(
      `👥 Connexions restantes dans "${docName}": ${remainingConnections}`
    );

    // Lister qui reste connecté
    if (remainingConnections > 0) {
      console.log(`🔗 Connexions actives dans "${docName}":`);
      conns.forEach((c, id) => {
        if (c.docName === docName) {
          console.log(`   • ${id} (connecté à ${c.connectedAt || 'N/A'})`);
        }
      });
    }

    // GARDER le document même si plus personne (pour persistance)
    if (remainingConnections === 0) {
      console.log(
        `💾 Document conservé: "${docName}" (persistance pour reconnexions)`
      );
      try {
        // Utiliser encodeStateAsUpdate pour obtenir la taille du document
        const updateSize = Y.encodeStateAsUpdate(doc).length;
        console.log(`📊 Taille document: ${updateSize} bytes`);
      } catch (error) {
        console.log(
          `📊 Taille document: [impossible à calculer] - ${error.message}`
        );
      }

      // Optionnel: nettoyer les vieux documents après un délai (ex: 1 heure)
      // setTimeout(() => {
      //   if (Array.from(conns.values()).filter(c => c.docName === docName).length === 0) {
      //     docs.delete(docName);
      //     console.log(`🗑️  Document expiré supprimé: "${docName}"`);
      //   }
      // }, 60 * 60 * 1000);
    }
    console.log(`🚪 ========================================\n`);
  });
});

server.listen(PORT, () => {
  console.log('💡 Serveur Y.js WebSocket PRÊT pour les connexions');
  console.log('📊 Monitoring détaillé activé');
  console.log('🔍 Logs: connexions, rooms, utilisateurs, awareness');
  console.log('🎯 ========================================\n');
});
