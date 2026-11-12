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