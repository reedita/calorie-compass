const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { GoogleGenAI } = require("@google/genai");
const multer = require("multer");
require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});

// Frontend is served from this same Express origin. Enable cross-origin only when explicitly configured.
const allowedOrigin = process.env.CORS_ORIGIN || null;
app.use(cors({ origin: allowedOrigin || false }));
app.use(express.json({ limit: "100kb" }));
// Never expose locally stored uploads or backend source files as public static files.
app.use("/uploads", (req, res) => res.status(404).json({ message: "Not found." }));
app.use(express.static(path.join(__dirname, "../html"), { dotfiles: "deny", index: false }));
app.use("/css", express.static(path.join(__dirname, "../css"), { dotfiles: "deny" }));
app.use("/js", express.static(path.join(__dirname, "../js"), { dotfiles: "deny" }));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../html/index.html"));
});
const db = require("./db");
// Gemini AI setup
const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

    // ======================================
// AUTH EMAIL + SECURITY CONFIGURATION
// ======================================

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many login attempts. Please try again in 15 minutes." }
});

const authCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many code requests. Please try again later." }
});

const recognitionLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many recognition attempts. Please wait before trying again." }
});

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}


const VALID_ACTIVITY_LEVELS = new Set(["sedentary", "light", "moderate", "active"]);
const VALID_GOALS = new Set(["lose", "maintain", "gain"]);
const VALID_HEIGHT_UNITS = new Set(["cm", "ftin"]);
const VALID_WEIGHT_UNITS = new Set(["kg", "lb"]);
const VALID_PORTION_UNITS = new Set(["g", "oz"]);
const VALID_MEALS = new Set(["Breakfast", "Lunch", "Dinner", "Snack", "Unspecified"]);

function isStrongPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password)
    );
}

function generateCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function saveAuthCode(email, purpose, code) {
    const codeHash = await bcrypt.hash(code, 10);

    await db.execute(
        `UPDATE auth_codes
         SET used = 1
         WHERE email = ? AND purpose = ? AND used = 0`,
        [email, purpose]
    );

    await db.execute(
        `INSERT INTO auth_codes
         (email, code_hash, purpose, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [email, codeHash, purpose]
    );
}

async function sendAuthCode(email, code, purpose) {
    const isVerification = purpose === "verify";

    await emailTransporter.sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject: isVerification
            ? "Verify your Calorie Compass account"
            : "Reset your Calorie Compass password",
        text: `Your Calorie Compass verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
                <h2 style="color:#315b40">Calorie Compass</h2>
                <p>${isVerification ? "Verify your email address using this code:" : "Use this code to reset your password:"}</p>
                <h1 style="letter-spacing:8px;color:#315b40">${code}</h1>
                <p>This code expires in 10 minutes.</p>
                <p>If you did not request this, you can ignore this email.</p>
            </div>
        `
    });
}
// Image upload configuration (memory only, maximum 5 MB)
const foodUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

        if (!allowedTypes.includes(file.mimetype)) {
            return callback(new Error("Only JPG, PNG and WEBP images are allowed."));
        }

        callback(null, true);
    }
}).single("foodImage");

// Handle image upload errors
function isImageBufferValid(file) {
    if (!file?.buffer) return false;
    const b = file.buffer;
    if (file.mimetype === "image/jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (file.mimetype === "image/png") return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (file.mimetype === "image/webp") return b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
    return false;
}


function handleFoodUpload(req, res, next) {
    foodUpload(req, res, (error) => {
        if (error) {
            const status = error instanceof multer.MulterError
                ? (error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
                : 400;

            return res.status(status).json({
                message: error.code === "LIMIT_FILE_SIZE"
                    ? "Image must be smaller than 5 MB."
                    : error.message
            });
        }

        next();
    });
}
// Verify user login token
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && /^Bearer\s+(.+)$/i.test(authHeader) ? authHeader.match(/^Bearer\s+(.+)$/i)[1] : null;

    if (!token) {
        return res.status(401).json({
            message: "Access denied. Please login."
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (error, user) => {
        if (error) {
            return res.status(403).json({
                message: "Invalid or expired token."
            });
        }

        req.user = user;
        next();
    });
}

/* ======================================
   AUTHENTICATION API
====================================== */

// Register (account remains unverified until OTP is confirmed)
app.post("/api/auth/register", authCodeLimiter, async (req, res) => {
    try {
        const {
            full_name,
            email,
            password,
            age,
            height_cm,
            weight_kg,
            activity_level,
            goal,
            height_unit = "cm",
            weight_unit = "kg",
            portion_unit = "g"
        } = req.body;

        const normalizedEmail = normalizeEmail(email);
        const cleanName = String(full_name || "").trim();

        if (!cleanName || !normalizedEmail || !password) {
            return res.status(400).json({ message: "Name, email and password are required." });
        }
        if (cleanName.length > 100 || /[\u0000-\u001f\u007f]/.test(cleanName)) {
            return res.status(400).json({ message: "Name must be 1–100 characters and contain no control characters." });
        }
        if (!VALID_ACTIVITY_LEVELS.has(activity_level)) {
            return res.status(400).json({ message: "Please select a valid activity level." });
        }
        if (!VALID_GOALS.has(goal)) {
            return res.status(400).json({ message: "Please select a valid goal." });
        }
        if (!VALID_HEIGHT_UNITS.has(height_unit) || !VALID_WEIGHT_UNITS.has(weight_unit) || !VALID_PORTION_UNITS.has(portion_unit)) {
            return res.status(400).json({ message: "Please choose valid measurement units." });
        }

        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({
                message: "Please enter a valid email address."
            });
        }

        if (!isStrongPassword(password)) {
            return res.status(400).json({
                message: "Password must have at least 8 characters, an uppercase letter, a lowercase letter and a number."
            });
        }

        if (password !== req.body.confirm_password) {
            return res.status(400).json({
                message: "Passwords do not match."
            });
        }

        if (!Number.isInteger(Number(age)) || Number(age) < 13 || Number(age) > 100) {
            return res.status(400).json({ message: "Age must be between 13 and 100." });
        }

        if (!Number.isFinite(Number(height_cm)) || Number(height_cm) < 100 || Number(height_cm) > 230) {
            return res.status(400).json({ message: "Height must be between 100 and 230 cm." });
        }

        if (!Number.isFinite(Number(weight_kg)) || Number(weight_kg) < 25 || Number(weight_kg) > 250) {
            return res.status(400).json({ message: "Weight must be between 25 and 250 kg." });
        }

        const [existingUsers] = await db.execute(
            "SELECT user_id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                message: "This email is already registered."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const [result] = await db.execute(
            `INSERT INTO users
            (full_name, email, password_hash, age, height_cm,
             weight_kg, activity_level, goal, height_unit, weight_unit, portion_unit, email_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
                cleanName,
                normalizedEmail,
                hashedPassword,
                Number(age),
                Number(height_cm),
                Number(weight_kg),
                activity_level,
                goal,
                height_unit,
                weight_unit,
                portion_unit
            ]
        );

        const code = generateCode();
        await saveAuthCode(normalizedEmail, "verify", code);

        try {
            await sendAuthCode(normalizedEmail, code, "verify");
        } catch (mailError) {
            console.error("Verification email delivery failed.");
            return res.status(503).json({
                message: "Account created, but the verification email could not be sent. Please try resending the code."
            });
        }

        res.status(201).json({
            message: "Account created. Please check your email for the verification code.",
            user_id: result.insertId,
            email: normalizedEmail
        });

    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This email is already registered."
            });
        }

        console.error("Registration error:", error.message);
        res.status(500).json({ message: "Registration failed." });
    }
});


// Verify registration email
app.post("/api/auth/verify-email", authCodeLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const code = String(req.body.code || "").trim();

        if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
            return res.status(400).json({
                message: "Enter a valid email and 6-digit code."
            });
        }

        const [codes] = await db.execute(
            `SELECT * FROM auth_codes
             WHERE email = ? AND purpose = 'verify' AND used = 0
             AND expires_at > NOW()
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [email]
        );

        if (codes.length === 0 || !(await bcrypt.compare(code, codes[0].code_hash))) {
            return res.status(400).json({
                message: "Invalid or expired verification code."
            });
        }

        await db.execute(
            "UPDATE auth_codes SET used = 1 WHERE id = ?",
            [codes[0].id]
        );

        await db.execute(
            "UPDATE users SET email_verified = 1 WHERE email = ?",
            [email]
        );

        res.json({
            message: "Email verified successfully. You can now log in."
        });

    } catch (error) {
        console.error("Email verification error:", error.message);
        res.status(500).json({ message: "Could not verify email." });
    }
});


// Resend verification code
app.post("/api/auth/resend-verification", authCodeLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);

        if (!isValidEmail(email)) {
            return res.status(400).json({
                message: "Please enter a valid email."
            });
        }

        const [users] = await db.execute(
            "SELECT user_id, email_verified FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0 || users[0].email_verified) {
            return res.json({
                message: "If your account requires verification, a code will be sent."
            });
        }

        const code = generateCode();
        await saveAuthCode(email, "verify", code);
        await sendAuthCode(email, code, "verify");

        res.json({
            message: "A new verification code has been sent."
        });

    } catch (error) {
        console.error("Resend verification error:", error.message);
        res.status(500).json({
            message: "Could not resend verification code."
        });
    }
});


// Login
app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = req.body.password;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required."
            });
        }

        const [users] = await db.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        // Same response for incorrect email and incorrect password
        if (users.length === 0) {
            return res.status(401).json({
                message: "Incorrect email or password."
            });
        }

        const user = users[0];
        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Incorrect email or password."
            });
        }

        // Local-only testing bypass. Keep disabled in deployment.
        const devVerificationBypass = process.env.DEV_ALLOW_UNVERIFIED_LOGIN === "true" && process.env.NODE_ENV !== "production";
        if (!user.email_verified && !devVerificationBypass) {
            return res.status(403).json({ message: "Please verify your email before logging in." });
        }

        const token = jwt.sign(
            { user_id: user.user_id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.json({
            message: "Login successful!",
            token,
            user: {
                user_id: user.user_id,
                full_name: user.full_name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ message: "Login failed." });
    }
});

/* ======================================
   FORGOT PASSWORD API
====================================== */

// Step 1: Request password reset code
app.post("/api/auth/forgot-password", authCodeLimiter, async (req, res) => {
    const genericMessage =
        "If that email is registered, we've sent a code.";

    try {
        const email = normalizeEmail(req.body.email);

        if (!isValidEmail(email)) {
            return res.json({ message: genericMessage });
        }

        const [users] = await db.execute(
            "SELECT user_id FROM users WHERE email = ? AND email_verified = 1",
            [email]
        );

        // Never reveal whether an account exists
        if (users.length === 0) {
            return res.json({ message: genericMessage });
        }

        const code = generateCode();
        await saveAuthCode(email, "reset", code);

        try {
            await sendAuthCode(email, code, "reset");
        } catch (mailError) {
            console.error("Password reset email delivery failed.");
            // Keep the response generic
        }

        res.json({ message: genericMessage });

    } catch (error) {
        console.error("Forgot password error:", error.message);
        res.json({ message: genericMessage });
    }
});


// Step 2: Verify reset code
app.post("/api/auth/verify-reset-code", authCodeLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const code = String(req.body.code || "").trim();

        if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
            return res.status(400).json({
                message: "Invalid or expired code."
            });
        }

        const [codes] = await db.execute(
            `SELECT * FROM auth_codes
             WHERE email = ? AND purpose = 'reset'
             AND used = 0 AND expires_at > NOW()
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [email]
        );

        if (codes.length === 0 || !(await bcrypt.compare(code, codes[0].code_hash))) {
            return res.status(400).json({
                message: "Invalid or expired code."
            });
        }

        // Mark code used and issue short-lived reset token
        await db.execute(
            "UPDATE auth_codes SET used = 1 WHERE id = ?",
            [codes[0].id]
        );

        const resetSessionId = crypto.randomUUID();
        await db.execute(
            "INSERT INTO password_reset_sessions (session_id, email, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
            [resetSessionId, email]
        );
        const resetToken = jwt.sign(
            { email, purpose: "password-reset", session_id: resetSessionId },
            process.env.JWT_SECRET,
            { expiresIn: "10m" }
        );

        res.json({ message: "Code verified.", resetToken });

    } catch (error) {
        console.error("Reset code verification error:", error.message);
        res.status(500).json({ message: "Could not verify reset code." });
    }
});


// Step 3: Set new password
app.post("/api/auth/reset-password", authCodeLimiter, async (req, res) => {
    try {
        const { resetToken, password, confirm_password } = req.body;

        if (!isStrongPassword(password)) {
            return res.status(400).json({
                message: "Password must have at least 8 characters, an uppercase letter, a lowercase letter and a number."
            });
        }

        if (password !== confirm_password) {
            return res.status(400).json({
                message: "Passwords do not match."
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        } catch {
            return res.status(400).json({
                message: "Reset session expired. Please start again."
            });
        }

        if (decoded.purpose !== "password-reset" || !decoded.email) {
            return res.status(400).json({
                message: "Invalid reset session."
            });
        }

        if (!decoded.session_id) {
            return res.status(400).json({ message: "Invalid reset session. Please start again." });
        }
        const hashedPassword = await bcrypt.hash(password, 12);
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [sessions] = await connection.execute(
                "SELECT session_id FROM password_reset_sessions WHERE session_id = ? AND email = ? AND used = 0 AND expires_at > NOW() FOR UPDATE",
                [decoded.session_id, decoded.email]
            );
            if (sessions.length === 0) {
                await connection.rollback();
                return res.status(400).json({ message: "Reset session has expired or was already used. Please start again." });
            }
            const [result] = await connection.execute(
                "UPDATE users SET password_hash = ? WHERE email = ? AND email_verified = 1",
                [hashedPassword, decoded.email]
            );
            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(400).json({ message: "Could not reset password. Please start again." });
            }
            await connection.execute("UPDATE password_reset_sessions SET used = 1 WHERE session_id = ?", [decoded.session_id]);
            await connection.commit();
        } catch (transactionError) {
            await connection.rollback();
            throw transactionError;
        } finally {
            connection.release();
        }
        await db.execute(`UPDATE auth_codes SET used = 1 WHERE email = ? AND purpose = 'reset' AND used = 0`, [decoded.email]);
        res.json({ message: "Password reset successful. Please log in." });

    } catch (error) {
        console.error("Password reset error:", error.message);
        res.status(500).json({ message: "Could not reset password." });
    }
});

// View own profile
app.get("/api/profile", authenticateToken, async (req, res) => {
    try {
        const [users] = await db.execute(
            `SELECT user_id, full_name, email, age, height_cm,
             weight_kg, activity_level, goal, height_unit, weight_unit, portion_unit, created_at
             FROM users WHERE user_id = ?`,
            [req.user.user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }

        res.json(users[0]);

    } catch (error) {
        console.error("Profile error:", error.message);
        res.status(500).json({ message: "Could not load profile." });
    }
});

// Update own profile
app.put("/api/profile", authenticateToken, async (req, res) => {
    try {
        const {
            full_name,
            age,
            height_cm,
            weight_kg,
            activity_level,
            goal,
            height_unit,
            weight_unit,
            portion_unit
        } = req.body;

        if (height_unit != null && !VALID_HEIGHT_UNITS.has(height_unit)) return res.status(400).json({ message: "Invalid height unit." });
        if (weight_unit != null && !VALID_WEIGHT_UNITS.has(weight_unit)) return res.status(400).json({ message: "Invalid weight unit." });
        if (portion_unit != null && !VALID_PORTION_UNITS.has(portion_unit)) return res.status(400).json({ message: "Invalid food portion unit." });

        if (full_name != null && (typeof full_name !== "string" || !full_name.trim() || full_name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(full_name))) {
            return res.status(400).json({ message: "Name must be 1–100 characters." });
        }
        if (activity_level != null && !VALID_ACTIVITY_LEVELS.has(activity_level)) {
            return res.status(400).json({ message: "Invalid activity level." });
        }
        if (goal != null && !VALID_GOALS.has(goal)) {
            return res.status(400).json({ message: "Invalid goal." });
        }
        if (age != null && (!Number.isInteger(Number(age)) || Number(age) < 13 || Number(age) > 100)) {
            return res.status(400).json({ message: "Age must be between 13 and 100." });
        }

        if (height_cm != null && (!Number.isFinite(Number(height_cm)) || Number(height_cm) < 100 || Number(height_cm) > 230)) {
            return res.status(400).json({ message: "Height must be between 100 and 230 cm." });
        }

        if (weight_kg != null && (!Number.isFinite(Number(weight_kg)) || Number(weight_kg) < 25 || Number(weight_kg) > 250)) {
            return res.status(400).json({ message: "Weight must be between 25 and 250 kg." });
        }

        const [result] = await db.execute(
            `UPDATE users SET
             full_name = COALESCE(?, full_name),
             age = COALESCE(?, age),
             height_cm = COALESCE(?, height_cm),
             weight_kg = COALESCE(?, weight_kg),
             activity_level = COALESCE(?, activity_level),
             goal = COALESCE(?, goal),
             height_unit = COALESCE(?, height_unit),
             weight_unit = COALESCE(?, weight_unit),
             portion_unit = COALESCE(?, portion_unit)
             WHERE user_id = ?`,
            [
                full_name?.trim() || null,
                age ?? null,
                height_cm ?? null,
                weight_kg ?? null,
                activity_level ?? null,
                goal ?? null,
                height_unit ?? null,
                weight_unit ?? null,
                portion_unit ?? null,
                req.user.user_id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "User not found." });
        }

        res.json({ message: "Profile updated successfully!" });

    } catch (error) {
        console.error("Profile update error:", error.message);
        res.status(500).json({ message: "Profile update failed." });
    }
});

// ======================================
// GEMINI FOOD RECOGNITION API
// ======================================

app.post(
    "/api/recognize-food",
    authenticateToken,
    recognitionLimiter,
    handleFoodUpload,
    async (req, res) => {
        try {
            if (!genAI) {
                return res.status(503).json({
                    message: "Food recognition is currently unavailable. Please try again later."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    message: "Please upload a food photo."
                });
            }

            const prompt = `You are a food identification assistant for a calorie-tracking app. Analyze the photo and identify visible food items, with special attention to Bangladeshi/South Asian foods (plain steamed rice, polao, biryani, khichuri, fried rice, dal, curry, bhaji). Do not invent ingredients or identify foods you cannot reasonably distinguish. Estimate portion grams visually and calories per 100 g; both are approximations. Return JSON only with this schema: {"isFood": boolean, "foodItems": [{"name": string, "estimatedPortionGrams": number, "estimatedCaloriesPer100g": number, "confidence": number, "notes": string}]}. If no identifiable food is present, return {"isFood":false,"foodItems":[]}. Confidence must be 0 to 1. Values must be positive and reasonable.`;

            const imagePart = {
                inlineData: {
                    mimeType: req.file.mimetype,
                    data: req.file.buffer.toString("base64")
                }
            };
            const userContent = [{ role: "user", parts: [{ text: prompt }, imagePart] }];
            // Prefer the configured low-cost model; fall back to a second supported model if capacity/access fails.
            const primaryModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
            const fallbackModels = [
                process.env.GEMINI_FALLBACK_MODEL || "gemini-3.6-flash",
                process.env.GEMINI_SECOND_FALLBACK_MODEL || "gemini-3.8-flash"
            ].filter(model => model && model !== primaryModel);
            const requestConfig = { responseMimeType: "application/json", temperature: 0.2 };

            async function callModel(model) {
                return genAI.models.generateContent({ model, contents: userContent, config: requestConfig });
            }
            function isTransientModelError(error) {
                const text = String(error?.message || error || "");
                const status = Number(error?.status || error?.code || 0);
                return status === 429 || status === 503 || /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(text);
            }
            function isModelUnavailable(error) {
                return /\b404\b|NOT_FOUND|model.*not available|model.*unavailable/i.test(String(error?.message || error || ""));
            }
            async function callModelWithRetry(model) {
                try { return await callModel(model); }
                catch (error) {
                    if (!/\b503\b|UNAVAILABLE|high demand/i.test(String(error?.message || error))) throw error;
                    await new Promise(resolve => setTimeout(resolve, 800));
                    return callModel(model);
                }
            }
            let response;
            let lastModelError;
            const modelChain = [primaryModel, ...fallbackModels];
            for (let modelIndex = 0; modelIndex < modelChain.length; modelIndex++) {
                const model = modelChain[modelIndex];
                try {
                    response = await callModelWithRetry(model);
                    break;
                } catch (modelError) {
                    lastModelError = modelError;
                    if (!isTransientModelError(modelError) && !isModelUnavailable(modelError)) throw modelError;
                    if (modelIndex < modelChain.length - 1) console.warn(`Gemini model ${model} failed; trying ${modelChain[modelIndex + 1]}.`);
                }
            }
            if (!response) throw lastModelError || new Error("No Gemini model returned a response.");

            const rawText = response.text;
            if (!rawText) throw new Error("Gemini returned an empty response.");
            const cleanedText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
            const result = JSON.parse(cleanedText);
            if (typeof result.isFood !== "boolean" || !Array.isArray(result.foodItems)) throw new Error("Invalid recognition response.");
            if (!result.isFood || result.foodItems.length === 0) return res.json({ isFood: false, foodItems: [] });

            const foodItems = result.foodItems
                .filter(item => item && typeof item.name === "string" && item.name.trim().length <= 150 &&
                    Number.isFinite(Number(item.estimatedPortionGrams)) && Number(item.estimatedPortionGrams) > 0 && Number(item.estimatedPortionGrams) <= 5000 &&
                    Number.isFinite(Number(item.estimatedCaloriesPer100g)) && Number(item.estimatedCaloriesPer100g) > 0 && Number(item.estimatedCaloriesPer100g) <= 1000)
                .map(item => ({
                    name: item.name.trim(),
                    estimatedPortionGrams: Number(item.estimatedPortionGrams),
                    estimatedCaloriesPer100g: Number(item.estimatedCaloriesPer100g),
                    confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
                    notes: String(item.notes || "Approximate visual estimate").slice(0, 250)
                }));
            if (!foodItems.length) return res.json({ isFood: false, foodItems: [] });
            res.json({ isFood: true, foodItems });

        } catch (error) {
            const errorText = String(error?.message || error || "");
            const unavailable = /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(errorText);
            console.error("Food recognition error:", errorText.slice(0, 500));
            res.status(unavailable ? 503 : 502).json({
                message: unavailable
                    ? "Food recognition is temporarily busy. Try again shortly or add the food manually."
                    : "Food recognition failed. Try another photo or add the food manually.",
                fallbackAvailable: true
            });
        }
    }
);

async function initUserUnitPreferences() {
    const columns = [
        ["height_unit", "VARCHAR(5) NOT NULL DEFAULT 'cm'"],
        ["weight_unit", "VARCHAR(2) NOT NULL DEFAULT 'kg'"],
        ["portion_unit", "VARCHAR(2) NOT NULL DEFAULT 'g'"]
    ];
    for (const [columnName, definition] of columns) {
        const [existing] = await db.query(`SHOW COLUMNS FROM users LIKE ?`, [columnName]);
        if (!existing.length) await db.query(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
    }
}


async function initPasswordResetSessions() {
    await db.query(`CREATE TABLE IF NOT EXISTS password_reset_sessions (
        session_id CHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_reset_session_email (email)
    )`);
    await db.execute("DELETE FROM password_reset_sessions WHERE expires_at < NOW() OR used = 1");
    await db.execute("DELETE FROM auth_codes WHERE expires_at < NOW() OR (used = 1 AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))");
}


// Start server
async function startServer() {
    try {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
            throw new Error("JWT_SECRET must be configured with at least 32 characters.");
        }
        const connection = await db.getConnection();
        console.log("MySQL database connected successfully!");
        connection.release();
        const [tableRows] = await db.query("SHOW TABLES");
        const tableNames = tableRows.map(row => Object.values(row)[0]);
        const requiredTables = ["users", "auth_codes", "food_entries"];
        const missingTables = requiredTables.filter(tableName => !tableNames.includes(tableName));
        if (missingTables.length) throw new Error(`Missing required database tables: ${missingTables.join(", ")}. Import database/schema.sql first.`);
        await initActivityAndWeightTables();
        await initUserUnitPreferences();
        await initPasswordResetSessions();

        const PORT = process.env.PORT || 3000;

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Database initialization failed:", error.message);
    }
}

startServer();


 // ======================================
 // FOOD DIARY APIs
 // ======================================

 // View food entries
 app.get("/api/food-entries", authenticateToken, async (req, res) => {
     try {
         const { date } = req.query;

         if (date && !isValidDateString(date)) {
             return res.status(400).json({ message: "Invalid date." });
         }

         let query = `
             SELECT id, id AS entry_id, food_name, meal_type,
                    portion_grams, portion_grams AS portion,
                    calories, entry_date, image_path, created_at
             FROM food_entries
             WHERE user_id = ?
         `;

         const params = [req.user.user_id];

         if (date) {
             query += " AND entry_date = ?";
             params.push(date);
         }

         query += " ORDER BY created_at DESC";

         const [entries] = await db.execute(query, params);
         res.json(entries);

     } catch (error) {
         console.error("Food diary error:", error.message);
         res.status(500).json({ message: "Could not load food entries." });
     }
 });

 // Daily calorie summary
 app.get("/api/food-entries/summary", authenticateToken, async (req, res) => {
     try {
         const { date } = req.query;

         if (!isValidDateString(date)) {
             return res.status(400).json({ message: "A valid date is required." });
         }

         const [result] = await db.execute(
             `SELECT COUNT(*) AS total_entries,
                     COALESCE(SUM(calories), 0) AS total_calories
              FROM food_entries
              WHERE user_id = ? AND entry_date = ?`,
             [req.user.user_id, date]
         );

         res.json(result[0]);

     } catch (error) {
         console.error("Daily summary error:", error.message);
         res.status(500).json({ message: "Could not load daily summary." });
     }
 });

 // Add food entry
 app.post("/api/food-entries", authenticateToken, async (req, res) => {
     try {
         const { food_name, meal_type, portion, calories, entry_date } = req.body;

         if (typeof food_name !== "string" || !food_name.trim() || food_name.trim().length > 150 ||
             !VALID_MEALS.has(meal_type) || !entry_date || portion == null || calories == null) {
             return res.status(400).json({
                 message: "Food name, meal type, portion, calories and date are required."
             });
         }

         if (!Number.isFinite(Number(portion)) || Number(portion) <= 0 || Number(portion) > 5000 ||
             !Number.isFinite(Number(calories)) || Number(calories) <= 0 || Number(calories) > 50000) {
             return res.status(400).json({ message: "Portion must be 1–5000 g and calories must be 1–50000 kcal." });
         }

         if (!isValidDateString(entry_date)) {
             return res.status(400).json({ message: "Invalid date." });
         }

         const [result] = await db.execute(
             `INSERT INTO food_entries
              (user_id, food_name, meal_type, portion_grams, calories, entry_date)
              VALUES (?, ?, ?, ?, ?, ?)`,
             [
                 req.user.user_id,
                 food_name.trim(),
                 meal_type,
                 Number(portion),
                 Number(calories),
                 entry_date
             ]
         );

         res.status(201).json({
             message: "Food entry added successfully!",
             entry_id: result.insertId
         });

     } catch (error) {
         console.error("Add food error:", error.message);
         res.status(500).json({ message: "Could not add food entry." });
     }
 });




// Update a food entry
app.put("/api/food-entries/:entryId", authenticateToken, async (req, res) => {
    try {
        const entryId = Number(req.params.entryId);
        const { food_name, meal_type, portion, calories, entry_date } = req.body;

        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: "Invalid entry ID." });
        }

        if (typeof food_name !== "string" || !food_name.trim() || food_name.trim().length > 150 ||
            !VALID_MEALS.has(meal_type) || portion == null || calories == null || !entry_date) {
            return res.status(400).json({
                message: "Required food information is missing."
            });
        }

        if (!Number.isFinite(Number(portion)) || Number(portion) <= 0 || Number(portion) > 5000 ||
            !Number.isFinite(Number(calories)) || Number(calories) <= 0 || Number(calories) > 50000) {
            return res.status(400).json({ message: "Portion must be 1–5000 g and calories must be 1–50000 kcal." });
        }

        if (!isValidDateString(entry_date)) {
            return res.status(400).json({ message: "Invalid date." });
        }

        const [existing] = await db.execute(
            "SELECT id FROM food_entries WHERE id = ? AND user_id = ?",
            [entryId, req.user.user_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ message: "Food entry not found." });
        }

        await db.execute(
            `UPDATE food_entries
             SET food_name = ?, meal_type = ?, portion_grams = ?,
                 calories = ?, entry_date = ?
             WHERE id = ? AND user_id = ?`,
            [
                food_name.trim(),
                meal_type,
                Number(portion),
                Number(calories),
                entry_date,
                entryId,
                req.user.user_id
            ]
        );

        res.json({ message: "Food entry updated successfully!" });

    } catch (error) {
        console.error("Update food error:", error.message);
        res.status(500).json({ message: "Could not update food entry." });
    }
});


// Delete a food entry
app.delete("/api/food-entries/:entryId", authenticateToken, async (req, res) => {
    try {
        const entryId = Number(req.params.entryId);

        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: "Invalid entry ID." });
        }

        const [result] = await db.execute(
            "DELETE FROM food_entries WHERE id = ? AND user_id = ?",
            [entryId, req.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Food entry not found." });
        }

        res.json({ message: "Food entry deleted successfully!" });

    } catch (error) {
        console.error("Delete food error:", error.message);
        res.status(500).json({ message: "Could not delete food entry." });
    }
});
// --------------------------------------------------
// ACTIVITY & WEIGHT TABLES + ROUTES (NAILA)
// --------------------------------------------------

async function initActivityAndWeightTables() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS activity_entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            activity_name VARCHAR(120) NOT NULL,
            duration_minutes INT NOT NULL,
            calories_burned DECIMAL(8, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_activity_user (user_id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS weight_entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            weight_kg DECIMAL(5, 2) NOT NULL,
            note VARCHAR(150) DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_weight_user (user_id)
        )
    `);

    // Add user_id to tables created by the earlier version of Naila's code.
    for (const table of ["activity_entries", "weight_entries"]) {
        const [columns] = await db.query(`SHOW COLUMNS FROM ${table} LIKE 'user_id'`);
        if (columns.length === 0) {
            await db.query(`ALTER TABLE ${table} ADD COLUMN user_id INT NULL`);
            await db.query(`CREATE INDEX idx_${table}_user ON ${table}(user_id)`);
        }
    }
}

// Retrieve logged activities
app.get("/api/activities", authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM activity_entries WHERE user_id = ? ORDER BY created_at DESC", [req.user.user_id]
        );
        res.json(rows);
    } catch (error) {
        console.error("Retrieve activities error:", error);
        res.status(500).json({ message: "Could not load activities." });
    }
});

// Save a new activity
app.post("/api/activities", authenticateToken, async (req, res) => {
    try {
        const { activityName, durationMinutes } = req.body;
        if (typeof activityName !== "string" || !activityName.trim() || activityName.trim().length > 120 || durationMinutes === undefined) {
            return res.status(400).json({ message: "Activity name and duration are required." });
        }
        const duration = Number(durationMinutes);
        if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) {
            return res.status(400).json({ message: "Duration must be a whole number between 1 and 1440 minutes." });
        }
        const activityRates = {
            "Walking": 4.1, "Brisk Walking": 5.3, "Running / Jogging": 10.0,
            "Cycling": 8.2, "Swimming": 8.8, "Jump Rope": 11.7,
            "Yoga / Stretching": 3.3, "Strength Training": 5.8,
            "Badminton / Football": 8.2
        };
        const met = activityRates[activityName.trim()] || 5.5; // custom activity default
        const [profiles] = await db.execute("SELECT weight_kg FROM users WHERE user_id = ?", [req.user.user_id]);
        const userWeight = Number(profiles[0]?.weight_kg);
        if (!Number.isFinite(userWeight) || userWeight <= 0) return res.status(400).json({ message: "Please update your profile weight before logging activities." });
        const calories = Math.round(met * 3.5 * userWeight / 200 * duration);
        if (!Number.isFinite(calories) || calories <= 0 || calories > 10000) {
            return res.status(400).json({ message: "Estimated activity calories are outside the allowed range." });
        }
        const [result] = await db.execute(
            `INSERT INTO activity_entries (user_id, activity_name, duration_minutes, calories_burned)
             VALUES (?, ?, ?, ?)`,
            [req.user.user_id, activityName.trim().slice(0, 120), duration, calories.toFixed(2)]
        );

        res.status(201).json({
            message: "Activity logged successfully!",
            activityId: result.insertId,
            caloriesBurned: calories
        });
    } catch (error) {
        console.error("Save activity error:", error);
        res.status(500).json({ message: "Could not save activity." });
    }
});

// Delete an activity
app.delete("/api/activities/:id", authenticateToken, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: "Invalid activity ID." });
        }

        const [result] = await db.execute(
            "DELETE FROM activity_entries WHERE id = ? AND user_id = ?",
            [id, req.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Activity entry not found." });
        }

        res.json({ message: "Activity deleted successfully." });
    } catch (error) {
        console.error("Delete activity error:", error);
        res.status(500).json({ message: "Failed to delete activity." });
    }
});

// Retrieve weight history
app.get("/api/weights", authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM weight_entries WHERE user_id = ? ORDER BY created_at DESC", [req.user.user_id]
        );
        res.json(rows);
    } catch (error) {
        console.error("Retrieve weights error:", error);
        res.status(500).json({ message: "Could not load weight history." });
    }
});

// Log a new weight entry
app.post("/api/weights", authenticateToken, async (req, res) => {
    try {
        const { weightKg, note } = req.body;
        const weight = Number(weightKg);

        if (!Number.isFinite(weight) || weight < 20 || weight > 500) {
            return res.status(400).json({
                message: "Enter a valid weight between 20 kg and 500 kg."
            });
        }

        const cleanNote = typeof note === "string" ? note.trim().slice(0, 150) : "";

        const [result] = await db.execute(
            `INSERT INTO weight_entries (user_id, weight_kg, note) VALUES (?, ?, ?)`,
            [req.user.user_id, weight.toFixed(2), cleanNote]
        );

        res.status(201).json({
            message: "Weight logged successfully!",
            weightId: result.insertId
        });
    } catch (error) {
        console.error("Save weight error:", error);
        res.status(500).json({ message: "Could not save weight entry." });
    }
});

// Delete a weight entry
app.delete("/api/weights/:id", authenticateToken, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ message: "Invalid weight entry ID." });
        }

        const [result] = await db.execute(
            "DELETE FROM weight_entries WHERE id = ? AND user_id = ?",
            [id, req.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Weight entry not found." });
        }

        res.json({ message: "Weight entry deleted successfully." });
    } catch (error) {
        console.error("Delete weight error:", error);
        res.status(500).json({ message: "Failed to delete weight entry." });
    }
});
// Global error handler

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                message: "Image must be smaller than 5 MB."
            });
        }
    }

    res.status(error.status || 400).json({
        message: error.message || "Something went wrong."
    });
});

module.exports = { app, db };
