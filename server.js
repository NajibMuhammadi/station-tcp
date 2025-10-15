import net from "net";
import { Server } from "socket.io";
import http from "http";

const TCP_PORT = process.env.TCP_PORT || 3001;
const TCP_HOST = process.env.TCP_HOST || "station1.serima.se";
const WS_PORT = process.env.WS_PORT || 4000;

let reconnectTimeout;
let lastScanMap = new Map();
let isCardReaderConnected = false;

const httpServer = http.createServer();
const io = new Server(httpServer, {
    cors: {
        origin: ["https://checkpoint.app.serima.se"],
        methods: ["GET", "POST"],
        credentials: true,
    },
});

httpServer.listen(WS_PORT, () => {
    console.log(`🛰️ WebSocket-server lyssnar på ws://localhost:${WS_PORT}`);
});

function connectTCP() {
    const tcpClient = new net.Socket();
    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log(`📡 Ansluten till TCP-server på ${TCP_HOST}:${TCP_PORT}`);
        tcpClient.setKeepAlive(true, 5000);

        if (!isCardReaderConnected) {
            isCardReaderConnected = true;
            console.log("✅ Card reader connected");
            io.emit("cardReaderConnected", { isOnline: true });
        }
    });

    tcpClient.on("data", (data) => {
        const uid = data
            .toString()
            .replace(/[^a-zA-Z0-9]/g, "")
            .trim();

        if (uid.includes("Deviceopenfailure")) return;

        const now = Date.now();
        const lastScan = lastScanMap.get(uid) || 0;

        if (now - lastScan < 2000) {
            console.warn(`⚠️ TCP UID ${uid} skannades nyligen – ignorerar`);
            return;
        }

        lastScanMap.set(uid, now);

        console.log("📥 TCP UID mottagen (rensad):", uid);
        io.emit("tcpData", uid);
    });

    tcpClient.on("close", () => {
        console.log("❌ TCP-anslutning stängd – försöker återansluta...");

        if (isCardReaderConnected) {
            isCardReaderConnected = false;
            console.log("❌ Card reader disconnected");
            io.emit("cardReaderConnected", { isOnline: false });
        }

        scheduleReconnect();
    });

    tcpClient.on("error", (err) => {
        console.error("⚠️ TCP-anslutningsfel:", err.message);
        if (isCardReaderConnected) {
            isCardReaderConnected = false;
            console.log("❌ Card reader disconnected");
            io.emit("cardReaderConnected", { isOnline: false });
        }
        tcpClient.destroy();
        scheduleReconnect();
    });
}

function scheduleReconnect() {
    if (reconnectTimeout) return;
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        console.log("🔄 Försöker återansluta till TCP-server...");
        connectTCP();
    }, 10000);
}

connectTCP();
