const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { GoogleGenAI } = require("@google/genai");
const multer = require("multer");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
// Serve frontend files
app.use(express.static(path.join(__dirname, "..")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../html/index.html"));
});
const db = require("./db");
// Gemini AI setup
const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

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
    const token = authHeader && authHeader.split(" ")[1];

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


// User Registration
app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            full_name,
            email,
            password,
            age,
            height_cm,
            weight_kg,
            activity_level,
            goal
        } = req.body;

        if (!full_name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters."
            });
        }

        if (age != null && (!Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 120)) {
            return res.status(400).json({ message: "Invalid age." });
        }

        if (height_cm != null && (!Number.isFinite(Number(height_cm)) || Number(height_cm) <= 0)) {
            return res.status(400).json({ message: "Invalid height." });
        }

        if (weight_kg != null && (!Number.isFinite(Number(weight_kg)) || Number(weight_kg) <= 0)) {
            return res.status(400).json({ message: "Invalid weight." });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [existingUsers] = await db.execute(
            "SELECT user_id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                message: "This email is already registered."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.execute(
            `INSERT INTO users
            (full_name, email, password_hash, age, height_cm,
             weight_kg, activity_level, goal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                full_name.trim(),
                normalizedEmail,
                hashedPassword,
                age ?? null,
                height_cm ?? null,
                weight_kg ?? null,
                activity_level ?? null,
                goal ?? null
            ]
        );

        res.status(201).json({
            message: "Registration successful!",
            user_id: result.insertId
        });

    } catch (error) {
        console.error("Registration error:", error.message);
        res.status(500).json({ message: "Registration failed." });
    }
});

// User Login
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required."
            });
        }

        const [users] = await db.execute(
            "SELECT * FROM users WHERE email = ?",
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
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

// View own profile
app.get("/api/profile", authenticateToken, async (req, res) => {
    try {
        const [users] = await db.execute(
            `SELECT user_id, full_name, email, age, height_cm,
             weight_kg, activity_level, goal, created_at
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
            goal
        } = req.body;

        if (age != null && (!Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 120)) {
            return res.status(400).json({ message: "Invalid age." });
        }

        if (height_cm != null && (!Number.isFinite(Number(height_cm)) || Number(height_cm) <= 0)) {
            return res.status(400).json({ message: "Invalid height." });
        }

        if (weight_kg != null && (!Number.isFinite(Number(weight_kg)) || Number(weight_kg) <= 0)) {
            return res.status(400).json({ message: "Invalid weight." });
        }

        const [result] = await db.execute(
            `UPDATE users SET
             full_name = COALESCE(?, full_name),
             age = COALESCE(?, age),
             height_cm = COALESCE(?, height_cm),
             weight_kg = COALESCE(?, weight_kg),
             activity_level = COALESCE(?, activity_level),
             goal = COALESCE(?, goal)
             WHERE user_id = ?`,
            [
                full_name?.trim() || null,
                age ?? null,
                height_cm ?? null,
                weight_kg ?? null,
                activity_level ?? null,
                goal ?? null,
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

            const prompt = `
You are a food identification assistant for a calorie tracking application.

Analyze the uploaded food photograph.

Pay special attention to South Asian and Bangladeshi foods.
Distinguish between visually similar foods where possible, such as:
- Plain steamed rice
- Polao
- Biryani
- Khichuri
- Fried rice

Identify each clearly visible food item separately.

Estimate the portion in grams based on the visible food.
This is only an approximate visual estimate. Do not claim exact measurements.

Estimate calories per 100 grams using reasonable nutritional values.
Do not invent ingredients or food items that cannot be identified.

If the image does not contain identifiable food, return:
{
  "isFood": false,
  "foodItems": []
}

Otherwise, return ONLY valid JSON in this exact structure:

{
  "isFood": true,
  "foodItems": [
    {
      "name": "Steamed rice",
      "estimatedPortionGrams": 150,
      "estimatedCaloriesPer100g": 130,
      "confidence": 0.90,
      "notes": "Approximate visual estimate"
    }
  ]
}

Confidence must be a number between 0 and 1.
All calorie and portion estimates must be positive numbers.
`;

            const response = await genAI.models.generateContent({
                model: "gemini-flash-latest",
                contents: [
                    {
                        inlineData: {
                            mimeType: req.file.mimetype,
                            data: req.file.buffer.toString("base64")
                        }
                    },
                    prompt
                ]
            });

            const rawText = response.text;

            if (!rawText) {
                throw new Error("Gemini returned an empty response.");
            }

            const cleanedText = rawText
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, "")
                .trim();

            const result = JSON.parse(cleanedText);

            if (
                typeof result.isFood !== "boolean" ||
                !Array.isArray(result.foodItems)
            ) {
                throw new Error("Invalid recognition response.");
            }

            if (!result.isFood || result.foodItems.length === 0) {
                return res.json({
                    isFood: false,
                    foodItems: []
                });
            }

            const foodItems = result.foodItems
                .filter(item =>
                    item.name &&
                    Number(item.estimatedPortionGrams) > 0 &&
                    Number(item.estimatedCaloriesPer100g) > 0
                )
                .map(item => ({
                    name: String(item.name).trim(),
                    estimatedPortionGrams: Number(item.estimatedPortionGrams),
                    estimatedCaloriesPer100g: Number(item.estimatedCaloriesPer100g),
                    confidence: Math.min(
                        1,
                        Math.max(0, Number(item.confidence) || 0)
                    ),
                    notes: String(item.notes || "Approximate visual estimate")
                }));

            if (foodItems.length === 0) {
                return res.json({
                    isFood: false,
                    foodItems: []
                });
            }

            res.json({
                isFood: true,
                foodItems
            });

        } catch (error) {
            console.error("Food recognition error:", error.message);

            res.status(502).json({
                message: "Food recognition failed. Please try another photo."
            });
        }
    }
);

// Start server
async function startServer() {
    try {
        const connection = await db.getConnection();
        console.log("MySQL database connected successfully!");
        connection.release();
        await initActivityAndWeightTables();

        const PORT = process.env.PORT || 3000;

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Database connection failed:", error.message);
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

         if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
             return res.status(400).json({ message: "Invalid date format." });
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

         if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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

         if (!food_name?.trim() || !meal_type || !entry_date ||
             portion == null || calories == null) {
             return res.status(400).json({
                 message: "Food name, meal type, portion, calories and date are required."
             });
         }

         if (!Number.isFinite(Number(portion)) || Number(portion) <= 0 ||
             !Number.isFinite(Number(calories)) || Number(calories) <= 0) {
             return res.status(400).json({ message: "Invalid portion or calorie amount." });
         }

         if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
             return res.status(400).json({ message: "Invalid date format." });
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

        if (!food_name?.trim() || !meal_type || portion == null ||
            calories == null || !entry_date) {
            return res.status(400).json({
                message: "Required food information is missing."
            });
        }

        if (!Number.isFinite(Number(portion)) || Number(portion) <= 0 ||
            !Number.isFinite(Number(calories)) || Number(calories) <= 0) {
            return res.status(400).json({
                message: "Invalid portion or calorie amount."
            });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
            return res.status(400).json({ message: "Invalid date format." });
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
        const { activityName, durationMinutes, caloriesBurned } = req.body;

        if (
            typeof activityName !== "string" ||
            activityName.trim() === "" ||
            durationMinutes === undefined ||
            caloriesBurned === undefined
        ) {
            return res.status(400).json({
                message: "Activity name, duration, and calories burned are required."
            });
        }

        const duration = Number(durationMinutes);
        const calories = Number(caloriesBurned);

        if (
            !Number.isFinite(duration) ||
            !Number.isFinite(calories) ||
            duration <= 0 ||
            duration > 1440 ||
            calories <= 0 ||
            calories > 10000
        ) {
            return res.status(400).json({
                message: "Enter a valid duration and calorie estimate greater than zero."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO activity_entries (user_id, activity_name, duration_minutes, calories_burned)
             VALUES (?, ?, ?, ?)`,
            [req.user.user_id, activityName.trim().slice(0, 120), Math.round(duration), calories.toFixed(2)]
        );

        res.status(201).json({
            message: "Activity logged successfully!",
            activityId: result.insertId
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
