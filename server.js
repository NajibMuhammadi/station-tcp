import net from "net";
import WebSocket, { WebSocketServer } from "ws";

const TCP_HOST = "localhost";
const TCP_PORT = 3001;
const WS_PORT = 4000;

let reconnectTimeout;
let lastScanMap = new Map();
let isCardReaderConnected = false;
let wsClient = null;

const wss = new WebSocketServer({ port: WS_PORT });

let tcpClient = null;

wss.on("connection", (ws) => {
    console.log("🌐 Frontend ansluten till WebSocket");
    wsClient = ws;

    // ✅ Skicka aktuell TCP-status när frontend ansluter
    console.log("📤 Skickar initial status:", isCardReaderConnected);
    ws.send(
        JSON.stringify({
            type: "cardReaderConnected",
            isOnline: isCardReaderConnected,
        })
    );

    ws.on("close", () => {
        console.log("🚪 Frontend frånkopplad från WebSocket");
        wsClient = null;
    });

    ws.on("error", (err) => {
        console.error("⚠️ WebSocket-fel:", err.message);
        wsClient = null;
    });
});

function connectTCP() {
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

// ==== Skicka direkt till frontend ====
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

// ==== Hantera bortkoppling ====
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

// ==== Automatisk återanslutning till TCP ====
function scheduleReconnect() {
    if (reconnectTimeout) return;

    console.log("⏱️ Schemalägger TCP-återanslutning om 10 sekunder...");
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        console.log("🔄 Försöker återansluta till TCP-server...");
        connectTCP();
    }, 10000);
}

process.on("SIGINT", () => {
    console.log("\nShutting down gracefully...");
    if (tcpClient) {
        tcpClient.destroy();
    }
    wss.close(() => {
        console.log("WebSocket server closed.");
        process.exit(0);
    });

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
});

// ==== Start ====
console.log("🌐 WebSocket-server startad på port", WS_PORT);
console.log("🔌 Startar TCP-anslutning om 500ms...");

setTimeout(() => {
    connectTCP();
}, 500);
