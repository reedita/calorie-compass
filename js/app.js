const foodImage = document.getElementById("foodImage");
const cameraImage = document.getElementById("cameraImage");
const uploadBtn = document.getElementById("uploadBtn");
const cameraBtn = document.getElementById("cameraBtn");
const dropZone = document.getElementById("dropZone");
const preview = document.getElementById("preview");
const previewWrap = document.getElementById("previewWrap");
const removePhotoBtn = document.getElementById("removePhotoBtn");
const recognizeBtn = document.getElementById("recognizeBtn");
const loadingState = document.getElementById("loadingState");
const recognitionMessage = document.getElementById("recognitionMessage");
const recognitionResults = document.getElementById("recognitionResults");
const emptyResults = document.getElementById("emptyResults");
const fallbackPanel = document.getElementById("fallbackPanel");
const manualFoodSearch = document.getElementById("manualFoodSearch");
const addManualFoodBtn = document.getElementById("addManualFoodBtn");
const foodEntries = document.getElementById("foodEntries");
const refreshBtn = document.getElementById("refreshBtn");
const saveBtn = document.getElementById("saveBtn");
const saveDock = document.getElementById("saveDock");
const totalCalories = document.getElementById("totalCalories");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toastMessage");

let selectedImage = null;
let recognizedFoods = [];
let previewUrl = null;
let toastTimer = null;
let isRecognizing = false;
let isSaving = false;

uploadBtn.addEventListener("click", () => foodImage.click());
cameraBtn.addEventListener("click", () => cameraImage.click());
dropZone.addEventListener("click", () => foodImage.click());
removePhotoBtn.addEventListener("click", clearSelectedImage);

foodImage.addEventListener("change", () => {
    handleImageSelection(foodImage.files[0]);
    foodImage.value = "";
});

cameraImage.addEventListener("change", () => {
    handleImageSelection(cameraImage.files[0]);
    cameraImage.value = "";
});

["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
        event.preventDefault();
        dropZone.classList.add("drag-over");
    });
});

["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
        event.preventDefault();
        dropZone.classList.remove("drag-over");
    });
});

dropZone.addEventListener("drop", event => {
    const file = event.dataTransfer.files[0];
    handleImageSelection(file);
});

function showMessage(message, type = "") {
    recognitionMessage.textContent = message;
    recognitionMessage.className = `message ${type}`.trim();
}

function handleImageSelection(file) {
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
        showMessage("Please choose a JPEG, PNG, or WEBP image.", "error");
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showMessage("This image is larger than 5 MB. Please choose a smaller image.", "error");
        return;
    }

    selectedImage = file;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);

    preview.src = previewUrl;
    previewWrap.hidden = false;
    dropZone.classList.add("has-image");
    document.getElementById("dropTitle").textContent = "Photo selected";
    document.getElementById("dropSubtitle").textContent = file.name;
    showMessage("Your photo is ready. Select Identify food when you're ready.", "success");

    recognizedFoods = [];
    renderRecognizedFoods();
    updateSaveDock();
    fallbackPanel.hidden = false;
    manualFoodSearch.value = "";
}

function clearSelectedImage() {
    selectedImage = null;
    preview.removeAttribute("src");
    previewWrap.hidden = true;
    dropZone.classList.remove("has-image");
    document.getElementById("dropTitle").textContent = "Tap to upload or take a photo";
    document.getElementById("dropSubtitle").textContent = "JPG, PNG or WEBP · Up to 5 MB";

    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    showMessage("");
}

// --------------------------------------------------
// FOOD RECOGNITION
// --------------------------------------------------

recognizeBtn.addEventListener("click", recognizeFood);

async function recognizeFood() {
    if (!selectedImage) {
        showMessage("Please upload or take a food photo first.", "error");
        return;
    }

    if (isRecognizing) return;

    isRecognizing = true;
    recognizeBtn.disabled = true;
    loadingState.hidden = false;
    recognitionResults.innerHTML = "";
    emptyResults.hidden = true;
    fallbackPanel.hidden = true;
    showMessage("");

    const formData = new FormData();
    formData.append("foodImage", selectedImage);

    try {
        const response = await fetch("/api/recognize-food", {
            method: "POST",
            body: formData
        });

        const responseText = await response.text();
        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
        }

        if (!response.ok) {
            throw new Error(result.message || "Food recognition failed. Please try again.");
        }

        if (!result.isFood || !Array.isArray(result.foodItems) || result.foodItems.length === 0) {
            recognizedFoods = [];
            renderRecognizedFoods();
            fallbackPanel.hidden = false;
            showMessage("We couldn't confidently identify food in this photo. You can enter it manually below.", "error");
            return;
        }

        recognizedFoods = result.foodItems.map(item => ({
            name: item.name || "",
            grams: item.estimatedPortionGrams ?? "",
            caloriesPer100: item.estimatedCaloriesPer100g ?? "",
            confidence: Number(item.confidence),
            notes: item.notes || ""
        }));

        renderRecognizedFoods();
        fallbackPanel.hidden = recognizedFoods.some(item =>
            !Number.isFinite(item.confidence) || item.confidence < 0.7
        );

        showMessage(
            `Found ${recognizedFoods.length} food item(s). Review the names and estimates before saving.`,
            "success"
        );
    } catch (error) {
        console.error("Food recognition error:", error);
        fallbackPanel.hidden = false;
        showMessage(error.message || "Recognition failed. Please try again.", "error");
    } finally {
        isRecognizing = false;
        recognizeBtn.disabled = false;
        loadingState.hidden = true;
    }
}

// --------------------------------------------------
// RECOGNITION RESULT CARDS
// --------------------------------------------------

function renderRecognizedFoods() {
    recognitionResults.innerHTML = "";

    if (recognizedFoods.length === 0) {
        emptyResults.hidden = false;
        updateSaveDock();
        return;
    }

    emptyResults.hidden = true;

    recognizedFoods.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "recognized-food";

        const top = document.createElement("div");
        top.className = "food-card-top";

        const heading = document.createElement("h3");
        heading.className = "food-card-title";
        heading.textContent = `Food item ${index + 1}`;

        const confidence = document.createElement("span");
        const isHighConfidence = Number.isFinite(item.confidence) && item.confidence >= 0.7;
        confidence.className = `confidence-badge ${isHighConfidence ? "" : "check"}`.trim();
        confidence.textContent = isHighConfidence ? "High confidence" : "Check this";

        top.append(heading, confidence);

        const nameField = createField("Food name", "text", item.name, "e.g. Steamed rice");
        nameField.input.maxLength = 150;
        nameField.input.addEventListener("input", () => {
            item.name = nameField.input.value;
            updateSaveDock();
        });

        const fieldGrid = document.createElement("div");
        fieldGrid.className = "field-grid";

        const gramsField = createField("Portion (grams)", "number", item.grams, "e.g. 150");
        gramsField.input.min = "1";
        gramsField.input.max = "5000";
        gramsField.input.step = "1";
        gramsField.input.addEventListener("input", () => {
            item.grams = gramsField.input.value;
            updateFoodEstimate(item, estimate);
            updateSaveDock();
        });

        const caloriesField = createField("Calories per 100 g", "number", item.caloriesPer100, "e.g. 130");
        caloriesField.input.min = "0.1";
        caloriesField.input.max = "1000";
        caloriesField.input.step = "0.1";
        caloriesField.input.addEventListener("input", () => {
            item.caloriesPer100 = caloriesField.input.value;
            updateFoodEstimate(item, estimate);
            updateSaveDock();
        });

        fieldGrid.append(gramsField.wrapper, caloriesField.wrapper);

        const estimate = document.createElement("div");
        estimate.className = "calorie-estimate";
        updateFoodEstimate(item, estimate);

        card.append(top, nameField.wrapper, fieldGrid, estimate);

        if (item.notes) {
            const notes = document.createElement("p");
            notes.className = "food-notes";
            notes.textContent = item.notes;
            card.appendChild(notes);
        }

        recognitionResults.appendChild(card);
    });

    updateSaveDock();
}

function createField(labelText, type, value, placeholder) {
    const wrapper = document.createElement("label");
    wrapper.className = "food-field";

    const label = document.createElement("span");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    input.placeholder = placeholder;
    if (type === "number") input.inputMode = "decimal";

    wrapper.append(label, input);
    return { wrapper, input };
}

function getFoodCalories(item) {
    const gramsText = String(item.grams ?? "").trim();
    const caloriesText = String(item.caloriesPer100 ?? "").trim();

    if (!gramsText || !caloriesText) return null;

    const grams = Number(gramsText);
    const caloriesPer100 = Number(caloriesText);

    if (!Number.isFinite(grams) || !Number.isFinite(caloriesPer100) ||
        grams <= 0 || caloriesPer100 <= 0 || grams > 5000 || caloriesPer100 > 1000) {
        return null;
    }

    return (grams / 100) * caloriesPer100;
}

function updateFoodEstimate(item, element) {
    const calories = getFoodCalories(item);
    element.innerHTML = "";

    const label = document.createElement("span");
    label.textContent = "Estimated calories";

    const value = document.createElement("strong");
    value.textContent = calories === null ? "— kcal" : `${calories.toFixed(1)} kcal`;

    element.append(label, value);
}

function validateFood(item) {
    const calories = getFoodCalories(item);
    return (
        typeof item.name === "string" &&
        item.name.trim().length > 0 &&
        item.name.trim().length <= 150 &&
        calories !== null
    );
}

function updateSaveDock() {
    const hasFoods = recognizedFoods.length > 0;
    saveDock.hidden = !hasFoods;

    const total = recognizedFoods.reduce((sum, item) => {
        const calories = getFoodCalories(item);
        return sum + (calories === null ? 0 : calories);
    }, 0);

    totalCalories.textContent = total.toFixed(1);
    saveBtn.disabled = !hasFoods || isSaving || !recognizedFoods.every(validateFood);
    saveBtn.title = saveBtn.disabled && hasFoods
        ? "Complete every food name, portion, and calorie value before saving."
        : "Save recognized foods to your diary";
}

// --------------------------------------------------
// MANUAL FOOD FALLBACK
// --------------------------------------------------

document.querySelectorAll(".suggestion-chip").forEach(button => {
    button.addEventListener("click", () => {
        manualFoodSearch.value = button.dataset.food;
        manualFoodSearch.focus();
    });
});

addManualFoodBtn.addEventListener("click", () => {
    const name = manualFoodSearch.value.trim();

    if (!name) {
        manualFoodSearch.focus();
        return;
    }

    recognizedFoods.push({
        name,
        grams: "",
        caloriesPer100: "",
        confidence: 0,
        notes: "Manually entered. Add a portion and verify the calorie estimate per 100 g."
    });

    renderRecognizedFoods();
    fallbackPanel.hidden = true;
    manualFoodSearch.value = "";
    showMessage("Food added for manual review. Complete its portion and calorie estimate before saving.", "success");
    document.getElementById("resultsTitle").scrollIntoView({ behavior: "smooth", block: "start" });
});

// --------------------------------------------------
// SAVE FOOD ENTRIES
// --------------------------------------------------

saveBtn.addEventListener("click", saveRecognizedFoods);

async function saveRecognizedFoods() {
    if (isSaving || recognizedFoods.length === 0) return;

    if (!recognizedFoods.every(validateFood)) {
        showMessage("Please complete every food name, portion, and calorie value before saving.", "error");
        return;
    }

    isSaving = true;
    updateSaveDock();
    saveBtn.innerHTML = '<span class="spinner small"></span> Saving...';

    const foodsToSave = [...recognizedFoods];
    let savedCount = 0;
    const failedFoods = [];

    for (const item of foodsToSave) {
        try {
            await saveRecognizedFood(item);
            savedCount++;
        } catch (error) {
            console.error(`Could not save ${item.name}:`, error);
            failedFoods.push({ item, error });
        }
    }

    recognizedFoods = failedFoods.map(entry => entry.item);
    renderRecognizedFoods();
    await loadFoodEntries();

    isSaving = false;
    saveBtn.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg> Save to diary';
    updateSaveDock();

    if (savedCount > 0 && failedFoods.length === 0) {
        showToast(savedCount === 1 ? "Added to your diary ✓" : `${savedCount} foods added to your diary ✓`);
        showMessage("");
    } else if (savedCount > 0) {
        showMessage(`${savedCount} item(s) saved. ${failedFoods.length} item(s) could not be saved; please try again.`, "error");
    } else {
        showMessage(failedFoods[0]?.error.message || "Your food entries could not be saved. Please try again.", "error");
    }
}

async function saveRecognizedFood(item) {
    const calories = getFoodCalories(item);

    if (!validateFood(item)) {
        throw new Error(`Please check the name, portion, and calories for ${item.name || "this food"}.`);
    }

    const formData = new FormData();
    formData.append("foodName", item.name.trim());
    formData.append("portionGrams", Number(item.grams));
    formData.append("calories", calories.toFixed(2));

    if (selectedImage) {
        formData.append("foodImage", selectedImage);
    }

    const response = await fetch("/api/food-entries", {
        method: "POST",
        body: formData
    });

    const responseText = await response.text();
    let result = {};

    try {
        result = responseText ? JSON.parse(responseText) : {};
    } catch {
        throw new Error("The server returned an invalid response while saving.");
    }

    if (!response.ok) {
        throw new Error(result.message || `Could not save ${item.name}.`);
    }
}

// --------------------------------------------------
// FOOD DIARY
// --------------------------------------------------

async function loadFoodEntries() {
    foodEntries.innerHTML = '<div class="diary-loading"><span class="spinner small"></span> Loading your diary...</div>';

    try {
        const response = await fetch("/api/food-entries");

        if (!response.ok) {
            throw new Error("Failed to retrieve food entries.");
        }

        const entries = await response.json();
        foodEntries.innerHTML = "";

        if (!Array.isArray(entries) || entries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "diary-empty";
            empty.textContent = "No food entries yet. Your saved meals will appear here.";
            foodEntries.appendChild(empty);
            return;
        }

        entries.forEach(entry => {
            const row = document.createElement("article");
            row.className = "diary-entry";

            const thumbnail = document.createElement("div");
            thumbnail.className = "diary-thumb";

            if (entry.image_path) {
                const image = document.createElement("img");
                image.src = entry.image_path;
                image.alt = entry.food_name || "Food";
                image.loading = "lazy";
                image.onerror = () => {
                    thumbnail.innerHTML = '<svg class="icon"><use href="#i-utensils"></use></svg>';
                };
                thumbnail.appendChild(image);
            } else {
                thumbnail.innerHTML = '<svg class="icon"><use href="#i-utensils"></use></svg>';
            }

            const info = document.createElement("div");
            info.className = "diary-info";

            const name = document.createElement("strong");
            name.textContent = entry.food_name || "Food entry";

            const details = document.createElement("span");
            details.textContent = `${entry.portion_grams} g`;

            const date = document.createElement("time");
            const parsedDate = new Date(entry.created_at);
            date.textContent = Number.isNaN(parsedDate.getTime())
                ? ""
                : parsedDate.toLocaleString();

            info.append(name, details, date);

            const calories = document.createElement("div");
            calories.className = "diary-calories";

            const calorieValue = document.createElement("strong");
            calorieValue.textContent = Number(entry.calories).toFixed(0);

            const calorieLabel = document.createElement("span");
            calorieLabel.textContent = "kcal";

            calories.append(calorieValue, calorieLabel);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "delete-button";
            deleteButton.setAttribute("aria-label", `Delete ${entry.food_name}`);
            deleteButton.title = "Delete entry";
            deleteButton.innerHTML = '<svg class="icon"><use href="#i-trash"></use></svg>';

            deleteButton.addEventListener("click", async () => {
                const confirmed = confirm(`Delete "${entry.food_name}" from your food diary?`);
                if (!confirmed) return;

                deleteButton.disabled = true;
                try {
                    await deleteFoodEntry(entry.id);
                    showToast("Food entry deleted");
                } catch (error) {
                    alert(error.message);
                    deleteButton.disabled = false;
                }
            });

            row.append(thumbnail, info, calories, deleteButton);
            foodEntries.appendChild(row);
        });
    } catch (error) {
        console.error("Load food entries error:", error);
        foodEntries.innerHTML = '<div class="diary-error">Could not load your diary. Please try refreshing.</div>';
    }
}

async function deleteFoodEntry(id) {
    const response = await fetch(`/api/food-entries/${encodeURIComponent(id)}`, {
        method: "DELETE"
    });

    const responseText = await response.text();
    let result = {};

    try {
        result = responseText ? JSON.parse(responseText) : {};
    } catch {
        throw new Error("The server returned an invalid response while deleting.");
    }

    if (!response.ok) {
        throw new Error(result.message || "Could not delete this food entry.");
    }

    await loadFoodEntries();
}

refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner small"></span>';
    await loadFoodEntries();
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<svg class="icon"><use href="#i-refresh"></use></svg>';
});

// --------------------------------------------------
// TOAST
// --------------------------------------------------

function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

// Initial diary load
renderRecognizedFoods();
loadFoodEntries();
// --------------------------------------------------
// ACTIVITY TRACKING (NAILA)
// --------------------------------------------------

const activitySelect = document.getElementById("activitySelect");
const activityDuration = document.getElementById("activityDuration");
const customActivityWrap = document.getElementById("customActivityWrap");
const customActivityInput = document.getElementById("customActivityInput");
const activityCaloriePreview = document.getElementById("activityCaloriePreview");
const activityMessage = document.getElementById("activityMessage");
const saveActivityBtn = document.getElementById("saveActivityBtn");
const activityEntries = document.getElementById("activityEntries");
const totalBurnedBadge = document.getElementById("totalBurnedBadge");
const fitnessTipText = document.getElementById("fitnessTipText");

const FITNESS_TIPS = [
    "Aim for at least 30 minutes of moderate movement most days, and stay hydrated before and after workouts.",
    "Short 15-minute walks after meals help digestion and steady daily energy.",
    "Combine light cardio like brisk walking or cycling with 2 days of bodyweight strength exercises each week.",
    "Consistency beats intensity—regular 20-minute sessions build lasting habits faster than occasional hard workouts."
];

if (fitnessTipText) {
    fitnessTipText.textContent = FITNESS_TIPS[new Date().getDate() % FITNESS_TIPS.length];
}

function getEstimatedBurnedCalories() {
    const minutes = Number(activityDuration.value);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
        return 0;
    }
    const selectedOption = activitySelect.options[activitySelect.selectedIndex];
    const rate = Number(selectedOption?.dataset.rate || 5.5);
    return Math.round(minutes * rate);
}

function updateActivityPreview() {
    const isCustom = activitySelect.value === "Custom";
    customActivityWrap.hidden = !isCustom;
    const burned = getEstimatedBurnedCalories();
    activityCaloriePreview.textContent = `${burned} kcal`;
}

function showActivityMessage(text, type = "") {
    activityMessage.textContent = text;
    activityMessage.className = `message ${type}`.trim();
}

activitySelect.addEventListener("change", updateActivityPreview);
activityDuration.addEventListener("input", updateActivityPreview);

document.querySelectorAll(".activity-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        activitySelect.value = chip.dataset.activity;
        activityDuration.value = chip.dataset.minutes;
        updateActivityPreview();
        showActivityMessage("Suggestion selected. Click Save activity to log it.", "success");
    });
});

saveActivityBtn.addEventListener("click", async () => {
    const isCustom = activitySelect.value === "Custom";
    const activityName = isCustom ? customActivityInput.value.trim() : activitySelect.value;
    const durationMinutes = Number(activityDuration.value);
    const caloriesBurned = getEstimatedBurnedCalories();

    if (!activityName) {
        showActivityMessage("Please enter a custom activity name.", "error");
        customActivityInput.focus();
        return;
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
        showActivityMessage("Please enter a valid duration in minutes (1 to 1440).", "error");
        activityDuration.focus();
        return;
    }

    saveActivityBtn.disabled = true;
    showActivityMessage("");

    try {
        const response = await fetch("/api/activities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activityName, durationMinutes, caloriesBurned })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || "Could not save activity.");
        }

        activityDuration.value = "";
        customActivityInput.value = "";
        updateActivityPreview();
        showToast("Activity logged ✓");
        await loadActivities();
    } catch (error) {
        showActivityMessage(error.message || "Could not save activity.", "error");
    } finally {
        saveActivityBtn.disabled = false;
    }
});

async function loadActivities() {
    try {
        const response = await fetch("/api/activities");
        if (!response.ok) throw new Error("Failed to load activities.");

        const items = await response.json();
        activityEntries.innerHTML = "";

        if (!Array.isArray(items) || items.length === 0) {
            totalBurnedBadge.textContent = "Total burned: 0 kcal";
            activityEntries.innerHTML = '<div class="diary-empty">No activities logged yet. Add a workout above to get started.</div>';
            return;
        }

        const totalBurned = items.reduce((sum, item) => sum + Number(item.calories_burned || 0), 0);
        totalBurnedBadge.textContent = `Total burned: ${Math.round(totalBurned)} kcal`;

        items.forEach(item => {
            const row = document.createElement("article");
            row.className = "diary-entry";

            const thumb = document.createElement("div");
            thumb.className = "diary-thumb";
            thumb.innerHTML = '<svg class="icon"><use href="#i-clock"></use></svg>';

            const info = document.createElement("div");
            info.className = "diary-info";

            const title = document.createElement("strong");
            title.textContent = item.activity_name;

            const details = document.createElement("span");
            details.textContent = `${item.duration_minutes} mins`;

            const date = document.createElement("time");
            const parsedDate = new Date(item.created_at);
            date.textContent = Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toLocaleString();

            info.append(title, details, date);

            const calories = document.createElement("div");
            calories.className = "diary-calories";

            const calVal = document.createElement("strong");
            calVal.textContent = Number(item.calories_burned).toFixed(0);

            const calUnit = document.createElement("span");
            calUnit.textContent = "kcal";

            calories.append(calVal, calUnit);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "delete-button";
            deleteBtn.title = "Delete activity";
            deleteBtn.innerHTML = '<svg class="icon"><use href="#i-trash"></use></svg>';
            deleteBtn.addEventListener("click", async () => {
                if (!confirm(`Delete "${item.activity_name}"?`)) return;
                deleteBtn.disabled = true;
                try {
                    const res = await fetch(`/api/activities/${encodeURIComponent(item.id)}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Could not delete activity.");
                    showToast("Activity deleted");
                    await loadActivities();
                } catch (err) {
                    alert(err.message);
                    deleteBtn.disabled = false;
                }
            });

            row.append(thumb, info, calories, deleteBtn);
            activityEntries.appendChild(row);
        });
    } catch (error) {
        console.error("Load activities error:", error);
    }
}

// --------------------------------------------------
// WEIGHT & PROGRESS TRACKING (NAILA)
// --------------------------------------------------

const weightInput = document.getElementById("weightInput");
const weightNoteInput = document.getElementById("weightNoteInput");
const weightMessage = document.getElementById("weightMessage");
const saveWeightBtn = document.getElementById("saveWeightBtn");
const weightEntries = document.getElementById("weightEntries");
const startWeightStat = document.getElementById("startWeightStat");
const latestWeightStat = document.getElementById("latestWeightStat");
const changeWeightStat = document.getElementById("changeWeightStat");
const weightChartContainer = document.getElementById("weightChartContainer");

function showWeightMessage(text, type = "") {
    weightMessage.textContent = text;
    weightMessage.className = `message ${type}`.trim();
}

saveWeightBtn.addEventListener("click", async () => {
    const weightKg = Number(weightInput.value);
    const note = weightNoteInput.value.trim();

    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 500) {
        showWeightMessage("Please enter a valid weight between 20 kg and 500 kg.", "error");
        weightInput.focus();
        return;
    }

    saveWeightBtn.disabled = true;
    showWeightMessage("");

    try {
        const response = await fetch("/api/weights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weightKg, note })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || "Could not save weight.");
        }

        weightInput.value = "";
        weightNoteInput.value = "";
        showToast("Weight logged ✓");
        await loadWeights();
    } catch (error) {
        showWeightMessage(error.message || "Could not save weight.", "error");
    } finally {
        saveWeightBtn.disabled = false;
    }
});

function renderWeightChart(chronologicalItems) {
    if (chronologicalItems.length < 2) {
        weightChartContainer.innerHTML =
            '<p class="helper-text" style="text-align: center; margin: 16px 0;">Log at least two weight entries to see your progress line.</p>';
        return;
    }

    const width = 520;
    const height = 160;
    const padX = 36;
    const padY = 26;

    const weights = chronologicalItems.map(item => Number(item.weight_kg));
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;

    const points = chronologicalItems.map((item, idx) => {
        const x = padX + (idx / (chronologicalItems.length - 1)) * (width - padX * 2);
        const y = height - padY - ((Number(item.weight_kg) - minW) / range) * (height - padY * 2);
        return { x, y, weight: Number(item.weight_kg).toFixed(1) };
    });

    const polylinePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const circles = points
        .map(
            p => `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#2f6f4e" />
            <text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" font-size="11" fill="#243127" font-weight="600">${p.weight} kg</text>
        `
        )
        .join("");

    weightChartContainer.innerHTML = `
        <svg class="weight-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight progress chart">
            <polyline fill="none" stroke="#2f6f4e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}" />
            ${circles}
        </svg>
    `;
}

async function loadWeights() {
    try {
        const response = await fetch("/api/weights");
        if (!response.ok) throw new Error("Failed to load weights.");

        const items = await response.json();
        weightEntries.innerHTML = "";

        if (!Array.isArray(items) || items.length === 0) {
            startWeightStat.textContent = "—";
            latestWeightStat.textContent = "—";
            changeWeightStat.textContent = "—";
            renderWeightChart([]);
            weightEntries.innerHTML = '<div class="diary-empty">No weight entries yet. Log your first weight above.</div>';
            return;
        }

        const chronological = [...items].reverse();
        const startWeight = Number(chronological[0].weight_kg);
        const latestWeight = Number(chronological[chronological.length - 1].weight_kg);
        const diff = latestWeight - startWeight;
        const sign = diff > 0 ? "+" : "";

        startWeightStat.textContent = `${startWeight.toFixed(1)} kg`;
        latestWeightStat.textContent = `${latestWeight.toFixed(1)} kg`;
        changeWeightStat.textContent = `${sign}${diff.toFixed(1)} kg`;

        renderWeightChart(chronological);

        items.forEach(item => {
            const row = document.createElement("article");
            row.className = "diary-entry";

            const thumb = document.createElement("div");
            thumb.className = "diary-thumb";
            thumb.innerHTML = '<svg class="icon"><use href="#i-check"></use></svg>';

            const info = document.createElement("div");
            info.className = "diary-info";

            const title = document.createElement("strong");
            title.textContent = `${Number(item.weight_kg).toFixed(1)} kg`;

            const note = document.createElement("span");
            note.textContent = item.note || "Weight check-in";

            const date = document.createElement("time");
            const parsedDate = new Date(item.created_at);
            date.textContent = Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toLocaleString();

            info.append(title, note, date);

            const badge = document.createElement("div");
            badge.className = "diary-calories";
            badge.innerHTML = `<strong>${Number(item.weight_kg).toFixed(1)}</strong><span>kg</span>`;

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "delete-button";
            deleteBtn.title = "Delete weight entry";
            deleteBtn.innerHTML = '<svg class="icon"><use href="#i-trash"></use></svg>';
            deleteBtn.addEventListener("click", async () => {
                if (!confirm(`Delete weight entry (${Number(item.weight_kg).toFixed(1)} kg)?`)) return;
                deleteBtn.disabled = true;
                try {
                    const res = await fetch(`/api/weights/${encodeURIComponent(item.id)}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Could not delete weight entry.");
                    showToast("Weight entry deleted");
                    await loadWeights();
                } catch (err) {
                    alert(err.message);
                    deleteBtn.disabled = false;
                }
            });

            row.append(thumb, info, badge, deleteBtn);
            weightEntries.appendChild(row);
        });
    } catch (error) {
        console.error("Load weights error:", error);
    }
}

updateActivityPreview();
loadActivities();
loadWeights();
