const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini configuration
const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    })
    : null;

const GEMINI_MODEL =
    process.env.GEMINI_MODEL || "gemini-flash-latest";


// Retry Gemini when its servers are temporarily unavailable
async function generateContentWithRetry(request, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await ai.models.generateContent(request);

        } catch (error) {
            console.error(
                `Gemini attempt ${attempt} failed:`,
                error.status
            );

            if (error.status !== 503 || attempt === maxAttempts) {
                throw error;
            }

            const delay = attempt * 3000;

            console.log(
                `Retrying Gemini in ${delay / 1000} seconds...`
            );

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Create uploads folder
const uploadFolder = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

app.use(cors());
app.use(express.json());

// Serve frontend
app.use("/css", express.static(path.join(__dirname, "..", "css")));
app.use("/js", express.static(path.join(__dirname, "..", "js")));
app.use("/uploads", express.static(uploadFolder));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "html", "index.html"));
});

// Disk storage for food diary images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadFolder);
    },

    filename: (req, file, cb) => {
        const uniqueName =
            Date.now() + "-" +
            Math.round(Math.random() * 1E9) +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }
});

// Memory storage for temporary AI recognition images
const memoryStorage = multer.memoryStorage();

function imageFilter(req, file, cb) {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Please upload a JPEG, PNG, or WEBP image."));
    }
}

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: imageFilter
});

const recognizeUpload = multer({
    storage: memoryStorage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: imageFilter
});

// Health test
app.get("/api/health", (req, res) => {
    res.json({
        message: "Calorie Compass backend is working!"
    });
});

// Database test
app.get("/api/db-test", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT 1 AS result");

        res.json({
            message: "Database connected!",
            result: rows[0]
        });
    } catch (error) {
        console.error("Database test:", error);

        res.status(500).json({
            message: "Database connection failed."
        });
    }
});

// --------------------------------------------------
// REAL AI FOOD RECOGNITION
// --------------------------------------------------

app.post(
    "/api/recognize-food",
    recognizeUpload.single("foodImage"),
    async (req, res) => {
        try {
            if (!ai) {
                return res.status(503).json({
                    message:
                        "Gemini API key is missing. Add GEMINI_API_KEY to .env."
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    message: "Please upload or capture a food image."
                });
            }

            const imageBase64 = req.file.buffer.toString("base64");

            const prompt = `
You are a food recognition assistant for Calorie Compass.

Analyze the provided photograph of food.

Identify every clearly visible food item that can reasonably
be distinguished. This includes separate components of mixed
meals, such as rice, chicken curry, vegetables, dal, and fish.

Do not invent food items that are not visible.
If the image is not food, return an empty foodItems array.

For each recognized item:
1. Provide a common food name in English.
2. Provide a more specific description when possible.
3. Estimate the edible portion in grams from visual appearance.
4. Estimate calories per 100 grams using general nutritional
   knowledge, if reasonably possible.
5. Give a confidence score between 0 and 1.
6. Explain briefly any uncertainty.

IMPORTANT:
- Portion weight is a visual estimate, NOT a measurement.
- Do not claim exact grams.
- Do not assume every rice dish is plain steamed rice.
- Distinguish biryani, pulao, fried rice, plain rice, etc.
  when visual evidence supports it.
- For mixed meals, return separate food items when possible.
- If uncertain, use a broad food name rather than guessing.
- Do not return markdown or explanatory text outside JSON.

Return ONLY valid JSON in this exact structure:

{
  "isFood": true,
  "foodItems": [
    {
      "name": "Steamed rice",
      "description": "Cooked white rice",
      "estimatedPortionGrams": 180,
      "estimatedCaloriesPer100g": 130,
      "confidence": 0.90,
      "notes": "Portion estimated visually"
    }
  ],
  "overallNotes": "Short explanation of the image"
}
`;

            
            const response = await generateContentWithRetry({
                model: GEMINI_MODEL,

                contents: [
                    {
                        inlineData: {
                            mimeType: req.file.mimetype,
                            data: imageBase64
                        }
                    },
                    {
                        text: prompt
                    }
                ],

                config: {
                    responseMimeType: "application/json",
                    temperature: 0.2
                }
            });


            const responseText = response.text;

            if (!responseText) {
                throw new Error("Gemini returned an empty response.");
            }

            let recognition;

            try {
                recognition = JSON.parse(responseText);
            } catch {
                console.error("Invalid Gemini JSON:", responseText);

                return res.status(502).json({
                    message:
                        "AI returned an invalid response. Please try again."
                });
            }

            if (
                !recognition ||
                typeof recognition.isFood !== "boolean" ||
                !Array.isArray(recognition.foodItems)
            ) {
                return res.status(502).json({
                    message:
                        "AI returned an unexpected recognition result."
                });
            }

            if (
                recognition.isFood &&
                recognition.foodItems.length === 0
            ) {
                return res.status(422).json({
                    message:
                        "Food was not identified clearly. Try another photo."
                });
            }

            // Validate and sanitize returned food items
            const foodItems = recognition.foodItems
                .filter(item =>
                    item &&
                    typeof item.name === "string" &&
                    item.name.trim()
                )
                .map(item => {
                    const grams = Number(item.estimatedPortionGrams);
                    const calories = Number(
                        item.estimatedCaloriesPer100g
                    );
                    const confidence = Number(item.confidence);

                    return {
                        name: item.name.trim().slice(0, 100),

                        description:
                            typeof item.description === "string"
                                ? item.description.slice(0, 250)
                                : "",

                        estimatedPortionGrams:
                            Number.isFinite(grams) &&
                            grams > 0 &&
                            grams <= 5000
                                ? Math.round(grams)
                                : null,

                        estimatedCaloriesPer100g:
                            Number.isFinite(calories) &&
                            calories >= 0 &&
                            calories <= 1000
                                ? Math.round(calories)
                                : null,

                        confidence:
                            Number.isFinite(confidence)
                                ? Math.min(1, Math.max(0, confidence))
                                : null,

                        notes:
                            typeof item.notes === "string"
                                ? item.notes.slice(0, 250)
                                : ""
                    };
                });

            if (recognition.isFood && foodItems.length === 0) {
                return res.status(422).json({
                    message:
                        "No valid food items could be extracted."
                });
            }

            res.json({
                message: "Food recognition completed.",
                isFood: recognition.isFood,
                foodItems,
                overallNotes:
                    typeof recognition.overallNotes === "string"
                        ? recognition.overallNotes
                        : ""
            });

        } catch (error) {
            console.error("Food recognition error:", error);

            if (error.status === 503) {
                return res.status(503).json({
                    message:
                        "The AI service is temporarily busy. Please wait a moment and try again."
                });
            }

            if (error.status === 429) {
                return res.status(429).json({
                    message:
                        "Gemini request limit reached. Wait and try again."
                });
            }

            if (error.status === 401 || error.status === 403) {
                return res.status(502).json({
                    message:
                        "Gemini authentication failed. Check your API key."
                });
            }

            res.status(502).json({
                message:
                    "Food recognition failed. Check your internet connection and try again."
            });
        }
    }
);

// --------------------------------------------------
// SAVE FOOD ENTRY
// --------------------------------------------------


app.post("/api/food-entries", upload.single("foodImage"), async (req, res) => {
    try {
        const { foodName, portionGrams, calories } = req.body;

        // Validate required fields
        if (
            typeof foodName !== "string" ||
            foodName.trim() === "" ||
            portionGrams === undefined ||
            String(portionGrams).trim() === "" ||
            calories === undefined ||
            String(calories).trim() === ""
        ) {
            return res.status(400).json({
                message: "Food name, portion, and calories are required."
            });
        }

        const grams = Number(portionGrams);
        const calorieValue = Number(calories);

        // Validate numeric values
        if (
            !Number.isFinite(grams) ||
            !Number.isFinite(calorieValue) ||
            grams <= 0 ||
            grams > 5000 ||
            calorieValue <= 0 ||
            calorieValue > 50000
        ) {
            return res.status(400).json({
                message: "Enter valid portion and calorie values greater than zero."
            });
        }

        const imagePath = req.file
            ? `/uploads/${req.file.filename}`
            : null;

        // INSERT FOOD ENTRY INTO MYSQL
        const [result] = await db.execute(
            `INSERT INTO food_entries
            (food_name, portion_grams, calories, image_path)
            VALUES (?, ?, ?, ?)`,
            [
                foodName.trim(),
                grams,
                calorieValue,
                imagePath
            ]
        );

        res.status(201).json({
            message: "Food entry saved successfully!",
            entryId: result.insertId
        });

    } catch (error) {
        console.error("Save food error:", error);

        // Remove uploaded image if database saving fails
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        res.status(500).json({
            message: "Could not save food entry."
        });
    }
});

// Retrieve food entries
app.get("/api/food-entries", async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM food_entries ORDER BY created_at DESC"
        );

        res.json(rows);

    } catch (error) {
        console.error("Retrieve food error:", error);

        res.status(500).json({
            message: "Could not retrieve food diary."
        });
    }
});


app.delete("/api/food-entries/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: "Invalid food entry ID."
            });
        }

        const [result] = await db.execute(
            "DELETE FROM food_entries WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Food entry not found."
            });
        }

        res.json({
            message: "Food entry deleted successfully."
        });

    } catch (error) {
        console.error("Delete food entry error:", error);

        res.status(500).json({
            message: "Failed to delete food entry."
        });
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

// Start server
app.listen(PORT, () => {
    console.log(`Calorie Compass running at http://localhost:${PORT}`);
});
