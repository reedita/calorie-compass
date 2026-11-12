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


const API_URL = "http://localhost:3000";

// Get today's date in local timezone
function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


// Registration
document.getElementById("register-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const message = document.getElementById("register-message");

    const userData = {
        full_name: document.getElementById("full_name").value,
        email: document.getElementById("register-email").value,
        password: document.getElementById("register-password").value,
        age: document.getElementById("age").value || null,
        height_cm: document.getElementById("height_cm").value || null,
        weight_kg: document.getElementById("weight_kg").value || null,
        activity_level: document.getElementById("activity_level").value || null,
        goal: document.getElementById("goal").value || null
    };

    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData)
        });

        const result = await response.json();

        message.textContent = result.message;
        message.style.color = response.ok ? "green" : "red";

        if (response.ok) {
            document.getElementById("register-form").reset();
        }

    } catch (error) {
        message.textContent = "Could not connect to server.";
        message.style.color = "red";
    }
});


// Login
document.getElementById("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const message = document.getElementById("login-message");

    const loginData = {
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value
    };

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(loginData)
        });

        const result = await response.json();

        if (response.ok) {
            localStorage.setItem("token", result.token);
            message.textContent = result.message;
            message.style.color = "green";

            document.getElementById("login-form").reset();

            await loadProfile();
        } else {
            message.textContent = result.message;
            message.style.color = "red";
        }

    } catch (error) {
        message.textContent = "Could not connect to server.";
        message.style.color = "red";
    }
});


// Load Profile & Show Only Profile Section initially after login
async function loadProfile() {
    const token = localStorage.getItem("token");

    if (!token) return;

    try {
        const response = await fetch(`${API_URL}/api/profile`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const result = await response.json();

        if (!response.ok) {
            localStorage.removeItem("token");
            alert(result.message);
            return;
        }

        document.getElementById("profile-name").value = result.full_name || "";
        document.getElementById("profile-age").value = result.age || "";
        document.getElementById("profile-height").value = result.height_cm || "";
        document.getElementById("profile-weight").value = result.weight_kg || "";
        document.getElementById("profile-activity").value = result.activity_level || "moderate";
        document.getElementById("profile-goal").value = result.goal || "maintain_weight";

        // Hide Auth & Food Diary using hidden class, and show ONLY Profile
        document.getElementById("auth-section").classList.add("hidden");
        document.getElementById("food-diary-section").classList.add("hidden");
        document.getElementById("profile-section").classList.remove("hidden");

        // Load Food Diary data in background
        document.getElementById("diary-date").value = getTodayDate();
        document.getElementById("food-date").value = getTodayDate();

        await loadFoodDiary();

    } catch (error) {
        alert("Could not load profile.");
    }
}


// Toggle between Profile and Food Diary via Buttons
document.addEventListener("click", function (event) {
    if (event.target && event.target.id === "goto-diary-btn") {
        document.getElementById("profile-section").classList.add("hidden");
        document.getElementById("food-diary-section").classList.remove("hidden");
    }

    if (event.target && event.target.id === "back-to-profile-btn") {
        document.getElementById("food-diary-section").classList.add("hidden");
        document.getElementById("profile-section").classList.remove("hidden");
    }
});


// Update Profile
document.getElementById("profile-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const token = localStorage.getItem("token");
    const message = document.getElementById("profile-message");

    const updatedData = {
        full_name: document.getElementById("profile-name").value,
        age: document.getElementById("profile-age").value || null,
        height_cm: document.getElementById("profile-height").value || null,
        weight_kg: document.getElementById("profile-weight").value || null,
        activity_level: document.getElementById("profile-activity").value,
        goal: document.getElementById("profile-goal").value
    };

    try {
        const response = await fetch(`${API_URL}/api/profile`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();

        message.textContent = result.message;
        message.style.color = response.ok ? "green" : "red";

    } catch (error) {
        message.textContent = "Could not update profile.";
        message.style.color = "red";
    }
});


// ======================================
// FOOD DIARY FUNCTIONS
// ======================================


// Load Food Entries and Daily Summary
async function loadFoodDiary() {
    const token = localStorage.getItem("token");
    const selectedDate = document.getElementById("diary-date").value;

    if (!token || !selectedDate) return;

    const list = document.getElementById("food-entries-list");

    try {
        const response = await fetch(
            `${API_URL}/api/food-entries?date=${selectedDate}`,
            {
                headers: { "Authorization": `Bearer ${token}` }
            }
        );

        const entries = await response.json();

        if (!response.ok) {
            list.textContent = entries.message || "Could not load food entries.";
            return;
        }

        renderFoodEntries(entries);

        const summaryResponse = await fetch(
            `${API_URL}/api/food-entries/summary?date=${selectedDate}`,
            {
                headers: { "Authorization": `Bearer ${token}` }
            }
        );

        const summary = await summaryResponse.json();

        if (summaryResponse.ok) {
            document.getElementById("total-entries").textContent =
                summary.total_entries;

            document.getElementById("total-calories").textContent =
                Number(summary.total_calories).toFixed(2);
        }

    } catch (error) {
        list.textContent = "Could not connect to server.";
    }
}


// Display Food Entries
function renderFoodEntries(entries) {
    const list = document.getElementById("food-entries-list");

    list.innerHTML = "";

    if (entries.length === 0) {
        list.innerHTML = "<p>No food entries found for this date. Add your first meal!</p>";
        return;
    }

    entries.forEach(function (entry) {
        const card = document.createElement("div");
        card.className = "food-entry-card";

        const name = document.createElement("h4");
        name.textContent = entry.food_name;

        const details = document.createElement("p");
        details.textContent =
            `${entry.meal_type} | ${entry.portion || "Portion not specified"} | ${entry.calories} kcal`;

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit";

        editButton.addEventListener("click", function () {
            editFoodEntry(entry);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", function () {
            deleteFoodEntry(entry.entry_id);
        });

        card.appendChild(name);
        card.appendChild(details);
        card.appendChild(editButton);
        card.appendChild(deleteButton);

        list.appendChild(card);
    });
}


// Add or Update Food Entry (Fixed for Multiple Entries and Auto Summary Updates)
document.getElementById("food-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const token = localStorage.getItem("token");
    const message = document.getElementById("food-message");
    const submitButton = document.getElementById("food-submit-button");
    const formElement = document.getElementById("food-form");

    const editId = formElement.dataset.editId;

    const foodData = {
        food_name: document.getElementById("food-name").value,
        meal_type: document.getElementById("meal-type").value,
        portion: document.getElementById("food-portion").value,
        calories: document.getElementById("food-calories").value,
        entry_date: document.getElementById("food-date").value
    };

    const url = editId
        ? `${API_URL}/api/food-entries/${editId}`
        : `${API_URL}/api/food-entries`;

    try {
        const response = await fetch(url, {
            method: editId ? "PUT" : "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(foodData)
        });

        const result = await response.json();

        message.textContent = result.message;
        message.style.color = response.ok ? "green" : "red";

        if (response.ok) {
            formElement.reset();
            
            // Clear edit state so subsequent submissions create new entries instead of replacing old ones
            delete formElement.dataset.editId;
            submitButton.textContent = "Add Food";

            document.getElementById("food-date").value = getTodayDate();
            document.getElementById("diary-date").value = foodData.entry_date;

            // Instantly refresh food list and calorie summary
            await loadFoodDiary();
        }

    } catch (error) {
        message.textContent = "Could not save food entry.";
        message.style.color = "red";
    }
});


// Edit Food Entry
function editFoodEntry(entry) {
    document.getElementById("food-name").value = entry.food_name;
    document.getElementById("meal-type").value = entry.meal_type;
    document.getElementById("food-portion").value = entry.portion || "";
    document.getElementById("food-calories").value = entry.calories;
    document.getElementById("food-date").value = entry.entry_date.substring(0, 10);

    const formElement = document.getElementById("food-form");
    formElement.dataset.editId = entry.entry_id;

    document.getElementById("food-submit-button").textContent = "Update Food";

    document.getElementById("food-message").textContent =
        "Editing food entry. Update the information and click Update Food.";

    formElement.scrollIntoView({
        behavior: "smooth"
    });
}


// Delete Food Entry
async function deleteFoodEntry(entryId) {
    const confirmed = confirm("Are you sure you want to delete this food entry?");

    if (!confirmed) return;

    const token = localStorage.getItem("token");
    const message = document.getElementById("food-message");

    try {
        const response = await fetch(
            `${API_URL}/api/food-entries/${entryId}`,
            {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            }
        );

        const result = await response.json();

        message.textContent = result.message;
        message.style.color = response.ok ? "green" : "red";

        if (response.ok) {
            await loadFoodDiary();
        }

    } catch (error) {
        message.textContent = "Could not delete food entry.";
        message.style.color = "red";
    }
};


// Change selected date
document.getElementById("diary-date").addEventListener("change", function () {
    loadFoodDiary();
});


// Logout
document.getElementById("logout-button").addEventListener("click", function () {
    localStorage.removeItem("token");

    document.getElementById("profile-section").classList.add("hidden");
    document.getElementById("food-diary-section").classList.add("hidden");
    document.getElementById("auth-section").classList.remove("hidden");

    document.getElementById("profile-message").textContent = "";
    document.getElementById("login-message").textContent = "";
    document.getElementById("food-message").textContent = "";

    alert("You have logged out successfully.");
});


// Check existing login when page opens
window.addEventListener("DOMContentLoaded", function () {
    loadProfile();
});