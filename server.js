import net from "net";
import WebSocket, { WebSocketServer } from "ws";

const TCP_HOST = "localhost";
const TCP_PORT = 3001;
const WS_PORT = 4000;

let reconnectTimeout;
let lastScanMap = new Map();
let isCardReaderConnected = false;
let wsClient = null;
let isShuttingDown = false; // 🆕 Flag för att förhindra reconnect vid shutdown

const wss = new WebSocketServer({ port: WS_PORT });
let tcpClient = null;

wss.on("connection", (ws) => {
    console.log("🌐 Frontend ansluten till WebSocket");
    wsClient = ws;

    console.log("📤 Skickar initial status:", isCardReaderConnected);
    ws.send(
        JSON.stringify({
            type: "cardReaderConnected",
            isOnline: isCardReaderConnected,
        })
    );

    ws.on("close", () => {
        console.log("🚪 Frontend frånkopplad från WebSocket");
        if (wsClient === ws) wsClient = null;
    });

    ws.on("error", (err) => {
        console.error("⚠️ WebSocket-fel:", err.message);
        if (wsClient === ws) wsClient = null;
    });
});

function connectTCP() {
    // 🆕 Avbryt om vi håller på att stänga ner
    if (isShuttingDown) {
        console.log("⛔ Shutdown pågår - avbryter TCP-anslutning");
        return;
    }

    tcpClient = new net.Socket();

    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log(`📡 Ansluten till TCP-server på ${TCP_HOST}:${TCP_PORT}`);
        tcpClient.setKeepAlive(true, 5000);

        if (!isCardReaderConnected) {
            isCardReaderConnected = true;
            console.log("✅ Card reader connected");
            sendToFrontend({ type: "cardReaderConnected", isOnline: true });
        }
    });

    tcpClient.on("data", (data) => {
        const uid = data
            .toString()
            .replace(/[^a-zA-Z0-9]/g, "")
            .trim();

        if (uid.includes("Deviceopenfailure")) return;
        if (uid.includes("Portalreadyinuse")) return;

        const now = Date.now();
        const lastScan = lastScanMap.get(uid) || 0;
        if (now - lastScan < 2000) return;

        lastScanMap.set(uid, now);
        console.log("📥 UID mottagen:", uid);
        sendToFrontend({ type: "tcpData", uid });
    });

    tcpClient.on("close", () => {
        console.log("❌ TCP-anslutning stängd");
        handleDisconnect();
    });

    tcpClient.on("error", (err) => {
        console.error("⚠️ TCP-fel:", err.message);
        handleDisconnect();
    });
}

function sendToFrontend(message) {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify(message));
        console.log("✉️ Meddelande skickat till frontend:", message.type);
    } else {
        console.log(
            "⏳ Frontend inte anslutet – status sparad:",
            message.type,
            "(TCP connected:",
            isCardReaderConnected,
            ")"
        );
    }
}

function handleDisconnect() {
    if (isCardReaderConnected) {
        isCardReaderConnected = false;
        console.log("❌ Card reader disconnected");
        sendToFrontend({ type: "cardReaderConnected", isOnline: false });
    }

    if (tcpClient) {
        tcpClient.destroy();
        tcpClient = null;
    }

    scheduleReconnect();
}

function scheduleReconnect() {
    // 🆕 Avbryt reconnect om vi håller på att stänga ner
    if (isShuttingDown || reconnectTimeout) return;

    console.log("⏱️ Schemalägger TCP-återanslutning om 10 sekunder...");
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        console.log("🔄 Försöker återansluta till TCP-server...");
        connectTCP();
    }, 10000);
}

// 🆕 ===== GRACEFUL SHUTDOWN =====
function cleanup() {
    if (isShuttingDown) return; // Förhindra dubbel-shutdown

    isShuttingDown = true;
    console.log("\n🛑 Stänger ner servern gracefully...");

    // Rensa reconnect-timer
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
        console.log("✅ Reconnect-timer rensad");
    }

    // Stäng TCP-klient
    if (tcpClient) {
        tcpClient.destroy();
        tcpClient = null;
        console.log("✅ TCP-klient stängd");
    }

    // Stäng WebSocket-klient
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        wsClient.close();
        wsClient = null;
        console.log("✅ WebSocket-klient stängd");
    }

    // Stäng WebSocket-server
    wss.close(() => {
        console.log("✅ WebSocket-server stängd");
        console.log("👋 Server avstängd - port 4000 är nu fri");
        process.exit(0);
    });

    // Force exit om det tar för länge
    setTimeout(() => {
        console.log("⚠️ Forcerad avstängning efter 5 sekunder");
        process.exit(1);
    }, 5000);
}

// 🆕 Lyssna på shutdown-signaler
process.on("SIGINT", () => {
    console.log("\n📥 SIGINT mottagen (Ctrl+C)");
    cleanup();
});

process.on("SIGTERM", () => {
    console.log("\n📥 SIGTERM mottagen");
    cleanup();
});

process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught Exception:", err);
    cleanup();
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    cleanup();
});

// ===== START =====
console.log("🌐 WebSocket-server startad på port", WS_PORT);
console.log("🔌 Startar TCP-anslutning om 500ms...");
console.log("💡 Tryck Ctrl+C för att stänga av servern");

setTimeout(() => {
    connectTCP();
}, 500);
