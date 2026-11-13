const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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

// Start server
async function startServer() {
    try {
        const connection = await db.getConnection();
        console.log("MySQL database connected successfully!");
        connection.release();

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

 // Update food entry
 app.put("/api/food-entries/:entryId", authenticateToken, async (req, res) => {
     try {
         const entryId = Number(req.params.entryId);
         const { food_name, meal_type, portion, calories, entry_date } = req.body;

         if (!Number.isInteger(entryId) || entryId <= 0) {
             return res.status(400).json({ message: "Invalid entry ID." });
         }

         if (!food_name?.trim() || !meal_type || portion == null ||
             calories == null || !entry_date) {
             return res.status(400).json({ message: "Required food information is missing." });
         }

         if (!Number.isFinite(Number(portion)) || Number(portion) <= 0 ||
             !Number.isFinite(Number(calories)) || Number(calories) <= 0) {
             return res.status(400).json({ message: "Invalid portion or calorie amount." });
         }

         if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
             return res.status(400).json({ message: "Invalid date format." });
         }

         const [result] = await db.execute(
             `UPDATE food_entries
              SET food_name = ?, meal_type = ?, portion_grams = ?,
                  calories = ?, entry_date = ?
              WHERE id = ? AND user_id = ?`,
             [
                 food_name.trim(), meal_type, Number(portion),
                 Number(calories), entry_date,
                 entryId, req.user.user_id
             ]
         );

         if (result.affectedRows === 0) {
             const [existing] = await db.execute(
                 "SELECT id FROM food_entries WHERE id = ? AND user_id = ?",
                 [entryId, req.user.user_id]
             );

             if (existing.length === 0) {
                 return res.status(404).json({ message: "Food entry not found." });
             }
         }

         res.json({ message: "Food entry updated successfully!" });

     } catch (error) {
         console.error("Update food error:", error.message);
         res.status(500).json({ message: "Could not update food entry." });
     }
 });

 // Delete food entry
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


// Get daily calorie summary
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


// Add a food entry
app.post("/api/food-entries", authenticateToken, async (req, res) => {
    try {
        const {
            food_name,
            meal_type,
            portion,
            calories,
            entry_date
        } = req.body;

        if (!food_name || !food_name.trim() || !meal_type || !entry_date || calories == null) {
            return res.status(400).json({
                message: "Food name, meal type, calories and date are required."
            });
        }

        if (!Number.isFinite(Number(calories)) || Number(calories) <= 0) {
            return res.status(400).json({ message: "Invalid calorie amount." });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
            return res.status(400).json({ message: "Invalid date format." });
        }

        const [result] = await db.execute(
            `INSERT INTO food_entries
             (user_id, food_name, meal_type, portion, calories, entry_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.user_id,
                food_name.trim(),
                meal_type,
                portion || null,
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

        const {
            food_name,
            meal_type,
            portion,
            calories,
            entry_date
        } = req.body;

        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: "Invalid entry ID." });
        }

        if (!food_name || !food_name.trim() || !meal_type || calories == null || !entry_date) {
            return res.status(400).json({ message: "Required food information is missing." });
        }

        if (!Number.isFinite(Number(calories)) || Number(calories) <= 0) {
            return res.status(400).json({ message: "Invalid calorie amount." });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
            return res.status(400).json({ message: "Invalid date format." });
        }

        const [result] = await db.execute(
            `UPDATE food_entries
             SET food_name = ?, meal_type = ?, portion = ?,
                 calories = ?, entry_date = ?
             WHERE entry_id = ? AND user_id = ?`,
            [
                food_name.trim(),
                meal_type,
                portion || null,
                Number(calories),
                entry_date,
                entryId,
                req.user.user_id
            ]
        );

        const [existing] = await db.execute(
            "SELECT entry_id FROM food_entries WHERE entry_id = ? AND user_id = ?",
            [entryId, req.user.user_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ message: "Food entry not found." });
        }

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
            "DELETE FROM food_entries WHERE entry_id = ? AND user_id = ?",
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

module.exports = { app, db };
