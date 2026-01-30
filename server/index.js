const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Environment configuration
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change_me";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Project paths
const ROOT = process.cwd();
const uploadsDir = path.join(ROOT, "uploads");
const dataDir = path.join(ROOT, "data");
const playlistsFile = path.join(dataDir, "playlists.json");
const webDir = path.join(ROOT, "web");

// Ensure required directories and files exist
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(playlistsFile)) {
  fs.writeFileSync(
    playlistsFile,
    JSON.stringify({ milano: [], cambiago: [] }, null, 2)
  );
}

// Read playlists from disk
function readPlaylists() {
  return JSON.parse(fs.readFileSync(playlistsFile, "utf-8"));
}

// Write playlists to disk
function writePlaylists(playlists) {
  fs.writeFileSync(playlistsFile, JSON.stringify(playlists, null, 2));
}

// Simple admin authentication via header token
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Multer storage configuration for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  }
});

// Accept only MP4 files, max size 1GB
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isMp4 =
      file.mimetype === "video/mp4" ||
      file.originalname.toLowerCase().endsWith(".mp4");
    cb(isMp4 ? null : new Error("Only MP4 files are allowed"), isMp4);
  }
});

// Static file serving
app.use("/uploads", express.static(uploadsDir));
app.use("/", express.static(webDir)); // serves player.html and admin.html

// Public API: get playlist for a specific screen/location
app.get("/api/playlist/:screenId", (req, res) => {
  const { screenId } = req.params;
  const playlists = readPlaylists();
  const list = playlists[screenId] || [];

  const mapped = list.map(item => ({
    ...item,
    url: item.url.startsWith("http")
      ? item.url
      : `${BASE_URL}${item.url}`
  }));

  res.json({
    screenId,
    updatedAt: new Date().toISOString(),
    items: mapped
  });
});

// Admin API: upload a video file
app.post("/api/upload", requireAdmin, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Missing file" });
  }

  const relUrl = `/uploads/${file.filename}`;

  res.json({
    ok: true,
    file: {
      filename: file.filename,
      originalname: file.originalname,
      url: `${BASE_URL}${relUrl}`,
      relUrl,
      size: file.size
    }
  });
});

// Admin API: get all playlists
app.get("/api/admin/playlist", requireAdmin, (req, res) => {
  res.json(readPlaylists());
});

// Admin API: save playlist for a specific screen/location
app.put("/api/admin/playlist/:screenId", requireAdmin, (req, res) => {
  const { screenId } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "`items` must be an array" });
  }

  const playlists = readPlaylists();

  playlists[screenId] = items
    .map((item, index) => ({
      id: item.id || `${Date.now()}_${index}`,
      title: String(item.title || "Video"),
      url: String(item.relUrl || item.url || ""),
      durationSec: item.durationSec ? Number(item.durationSec) : null
    }))
    .filter(item => item.url);

  writePlaylists(playlists);

  res.json({
    ok: true,
    screenId,
    count: playlists[screenId].length
  });
});

// Admin API: delete a video file and remove it from all playlists
app.delete("/api/admin/file/:filename", requireAdmin, (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = path.join(uploadsDir, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  const playlists = readPlaylists();
  Object.keys(playlists).forEach(key => {
    playlists[key] = playlists[key].filter(
      item => !item.url.includes(filename)
    );
  });

  writePlaylists(playlists);

  res.json({ ok: true });
});

// Start server (bind to all interfaces for hosting environments)
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Signage server running on ${BASE_URL} (port ${PORT})`);
});
