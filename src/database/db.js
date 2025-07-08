// src/database/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Ma'lumotlar bazasi fayli loyiha ildiz papkasida bo'lishi uchun
const DB_PATH = path.join(__dirname, '..', '..', 'user.sqlite'); 

let db;

function connectDB() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error("Ma'lumotlar bazasiga ulanishda xatolik:", err.message);
                reject(err);
            } else {
                console.log('SQLite ma\'lumotlar bazasiga muvaffaqiyatli ulanildi.');
                resolve(db);
            }
        });
    });
}

function initDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Ma'lumotlar bazasiga ulanilmagan. Avval connectDB() ni chaqiring."));
        }
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                chat_id INTEGER PRIMARY KEY,
                language TEXT DEFAULT 'uz',
                first_name TEXT,
                last_name TEXT,
                username TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error("`users` jadvalini yaratishda xatolik:", err.message);
                    reject(err);
                } else {
                    console.log("`users` jadvali tayyor (yoki allaqachon mavjud).");
                    resolve();
                }
            });
        });
    });
}

function getUser(chatId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Ma'lumotlar bazasiga ulanilmagan."));
        }
        db.get("SELECT * FROM users WHERE chat_id = ?", [chatId], (err, row) => {
            if (err) {
                console.error("Foydalanuvchini MBdan olishda xatolik:", err.message);
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

function upsertUser(chatId, language, userInfo = {}) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error("Ma'lumotlar bazasiga ulanilmagan."));
        }
        const { first_name = null, last_name = null, username = null } = userInfo;
        const stmt = `INSERT INTO users (chat_id, language, first_name, last_name, username, updated_at) 
                      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                      ON CONFLICT(chat_id) DO UPDATE SET 
                      language = excluded.language,
                      first_name = COALESCE(excluded.first_name, users.first_name),
                      last_name = COALESCE(excluded.last_name, users.last_name),
                      username = COALESCE(excluded.username, users.username),
                      updated_at = CURRENT_TIMESTAMP`;
        
        db.run(stmt, [chatId, language, first_name, last_name, username], function (err) {
            if (err) {
                console.error("Foydalanuvchini MBda saqlash/yangilashda xatolik:", err.message);
                reject(err);
                return;
            }
            resolve(this.changes > 0);
        });
    });
}

function closeDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error("Ma'lumotlar bazasini yopishda xatolik:", err.message);
                    reject(err);
                    return;
                }
                console.log('Ma\'lumotlar bazasi ulanishi yopildi.');
                db = null; // db o'zgaruvchisini tozalash
                resolve();
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    connectDB,
    initDB,
    getUser,
    upsertUser,
    closeDB
};