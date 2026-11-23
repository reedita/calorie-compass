let dashboardUser = null;
const UNIT_PREFS_KEY = "calorieCompassUnits";
const DEFAULT_UNITS = { height: "cm", weight: "kg", portion: "g" };
let unitPrefs = (() => {
    try { return { ...DEFAULT_UNITS, ...(JSON.parse(localStorage.getItem(UNIT_PREFS_KEY) || "{}")) }; }
    catch { return { ...DEFAULT_UNITS }; }
})();
function saveUnitPrefs() { localStorage.setItem(UNIT_PREFS_KEY, JSON.stringify(unitPrefs)); }
function poundsToKg(value) { return Number(value) / 2.2046226218; }
function kgToPounds(value) { return Number(value) * 2.2046226218; }
function ouncesToGrams(value) { return Number(value) * 28.349523125; }
function gramsToOunces(value) { return Number(value) / 28.349523125; }
function parseHeightCm(value, unit) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (unit === "cm") return Number(text);
    const match = text.match(/^(\d{1,2})\s*(?:ft|feet|')\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:in|inch|inches|\")?)?$/i);
    if (!match) return NaN;
    const feet = Number(match[1]); const inches = Number(match[2] || 0);
    if (inches >= 12 || feet < 1 || feet > 8) return NaN;
    return (feet * 12 + inches) * 2.54;
}
function formatHeight(valueCm, unit) {
    if (!Number.isFinite(Number(valueCm))) return "";
    if (unit === "cm") return Number(valueCm).toFixed(1).replace(/\.0$/, "");
    const totalInches = Math.round(Number(valueCm) / 2.54);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet} ft ${inches} in`;
}
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
let pendingVerificationEmail = "";
let passwordResetToken = "";
let resendCountdown = 0;
let resendTimer = null;
let verificationResendCountdown = 0;
let verificationResendTimer = null;
const authSection = document.getElementById("auth-section");
const profileSection = document.getElementById("profile-section");

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const profileForm = document.getElementById("profile-form");

const registerMessage = document.getElementById("register-message");
const loginMessage = document.getElementById("login-message");
const profileMessage = document.getElementById("profile-message");

const logoutButton = document.getElementById("logout-button");

document.querySelectorAll("[data-toggle-password]").forEach(button => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.togglePassword);
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.textContent = showing ? "Show" : "Hide";
        button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
});

const registrationPassword = document.getElementById("register-password");
const confirmRegistrationPassword = document.getElementById("register-confirm-password");
const passwordRuleChecks = {
    length: value => value.length >= 8,
    upper: value => /[A-Z]/.test(value),
    lower: value => /[a-z]/.test(value),
    number: value => /[0-9]/.test(value)
};


function updatePasswordRules() {
    const value = registrationPassword.value;
    let passedCount = 0;

    Object.entries(passwordRuleChecks).forEach(([rule, check]) => {
        const item = document.querySelector(`[data-rule="${rule}"]`);
        const passed = check(value);

        item.classList.toggle("passed", passed);
        if (passed) passedCount++;
    });

    const bar = document.getElementById("password-strength-bar");
    const label = document.getElementById("password-strength-label");

    const percentage = (passedCount / 4) * 100;
    bar.style.width = `${percentage}%`;

    const levels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
    label.textContent = value.length === 0
        ? "Password strength"
        : levels[passedCount];
}

registrationPassword.addEventListener("input", updatePasswordRules);

const landingSection = document.getElementById("landing-section");
const landingRegisterButton = document.getElementById("landing-register");
const landingLoginButton = document.getElementById("landing-login");


// PHASE 2: Screen navigation (shared desktop sidebar / mobile bottom tabs)
let currentAppScreen = "home";
function showAppScreen(screen) {
    const validScreens = ["home", "diary", "scan", "activity", "progress", "profile"];
    if (!validScreens.includes(screen)) screen = "home";
    currentAppScreen = screen;
    const home = document.getElementById("homePanel");
    const intro = document.querySelector(".intro");
    const capture = document.querySelector(".capture-panel");
    const results = document.querySelector(".results-panel");
    const diary = document.querySelector(".diary-panel");
    const activity = document.querySelector(".activity-panel");
    const weight = document.querySelector(".weight-panel");
    const profile = document.getElementById("profile-section");
    if (home) home.hidden = screen !== "home";
    if (intro) intro.hidden = screen !== "scan";
    if (capture) capture.hidden = screen !== "scan";
    if (results) results.hidden = screen !== "scan";
    if (diary) diary.hidden = screen !== "diary";
    if (activity) activity.hidden = screen !== "activity";
    if (weight) weight.hidden = screen !== "progress";
    if (profile) profile.hidden = screen !== "profile";
    document.querySelectorAll(".app-nav-button").forEach(button => {
        button.classList.toggle("active", button.dataset.screen === screen);
        button.setAttribute("aria-current", button.dataset.screen === screen ? "page" : "false");
    });
    if (screen === "diary") loadFoodEntries();
    if (screen === "activity") loadActivities();
    if (screen === "progress") loadWeights();
    if (screen === "scan") window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".app-nav-button").forEach(button => {
    button.addEventListener("click", () => showAppScreen(button.dataset.screen));
});
document.querySelectorAll("[data-go-screen]").forEach(button => {
    button.addEventListener("click", () => showAppScreen(button.dataset.goScreen));
});
// More menu: profile/settings, help and logout (without crowding mobile tabs)
const moreToggle = document.getElementById("moreMenuToggle");
const moreMenu = document.getElementById("moreMenu");
if (moreToggle && moreMenu) {
    moreToggle.addEventListener("click", () => {
        moreMenu.hidden = !moreMenu.hidden;
        moreToggle.setAttribute("aria-expanded", String(!moreMenu.hidden));
    });
    moreMenu.querySelectorAll("[data-more-action]").forEach(action => action.addEventListener("click", () => {
        moreMenu.hidden = true;
        moreToggle.setAttribute("aria-expanded", "false");
        const choice = action.dataset.moreAction;
        if (choice === "profile") showAppScreen("profile");
        if (choice === "help") document.getElementById("helpModal").hidden = false;
        if (choice === "logout") logoutButton.click();
    }));
}
const helpModal = document.getElementById("helpModal");
const helpClose = document.getElementById("helpClose");
if (helpClose && helpModal) helpClose.addEventListener("click", () => helpModal.hidden = true);
if (helpModal) helpModal.addEventListener("click", event => { if (event.target === helpModal) helpModal.hidden = true; });

function openAuthForm(form) {
    if (form === "register") showRegisterStep(0);
    registerMessage.textContent = ""; loginMessage.textContent = "";
    loginResendVerificationButton.hidden = true;
    landingSection.hidden = true;
    authSection.hidden = false;
    verificationPanel.hidden = true;
    forgotPanel.hidden = true;

    registerForm.hidden = form !== "register";
    loginForm.hidden = form !== "login";

    const isLogin = form === "login";

    document.getElementById("auth-title").textContent =
        isLogin ? "Welcome back!" : "Create your account";

    document.getElementById("auth-subtitle").textContent =
        isLogin
            ? "Log in to continue your journey."
            : "Let's get you started on a healthier routine.";

    document.getElementById(isLogin ? "login-email" : "full_name").focus();

    authSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

landingRegisterButton.addEventListener("click", () => openAuthForm("register"));
landingLoginButton.addEventListener("click", () => openAuthForm("login"));

// Three-step registration wizard. Inactive steps are disabled so native validation
// only checks the fields currently visible to the user.
let registerStepIndex = 0;
function showRegisterStep(index) {
    registerStepIndex = index;
    document.querySelectorAll("[data-register-step]").forEach(step => {
        const active = Number(step.dataset.registerStep) === index;
        step.hidden = !active;
        step.querySelectorAll("input, select").forEach(field => field.disabled = !active);
    });
}
showRegisterStep(0);
const signupHeightUnit = document.getElementById("register-height-unit");
const signupWeightUnit = document.getElementById("register-weight-unit");
const signupHeightInput = document.getElementById("height_cm");
const signupWeightInput = document.getElementById("weight_kg");
const profileHeightUnit = document.getElementById("profile-height-unit");
const profileWeightUnit = document.getElementById("profile-weight-unit");
const profileHeightInput = document.getElementById("profile-height");
const profileWeightInput = document.getElementById("profile-weight");
const signupPortionUnit = document.getElementById("register-portion-unit");
const profilePortionUnit = document.getElementById("profile-portion-unit");
function updateHeightInputForUnit(input, oldUnit, newUnit) {
    const cm = parseHeightCm(input.value, oldUnit);
    input.value = Number.isFinite(cm) ? formatHeight(cm, newUnit) : "";
}
function updateWeightInputForUnit(input, oldUnit, newUnit) {
    if (String(input.value).trim() === "") { input.value = ""; return; }
    const kg = oldUnit === "lb" ? poundsToKg(input.value) : Number(input.value);
    input.value = Number.isFinite(kg) ? (newUnit === "lb" ? kgToPounds(kg) : kg).toFixed(1) : "";
}
function applySignupHeightUnit(unit) {
    document.getElementById("register-height-label").textContent = `Height (${unit === "cm" ? "cm" : "ft/in"})`;
    signupHeightInput.placeholder = unit === "cm" ? "e.g. 165" : "e.g. 5 ft 4 in";
    signupHeightInput.inputMode = unit === "cm" ? "decimal" : "text";
    profileHeightInput.inputMode = unit === "cm" ? "decimal" : "text";
}
function applySignupWeightUnit(unit) {
    document.getElementById("register-weight-label").textContent = `Weight (${unit})`;
    signupWeightInput.min = unit === "lb" ? "55.1" : "25";
    signupWeightInput.max = unit === "lb" ? "551.2" : "250";
    profileWeightInput.min = unit === "lb" ? "55.1" : "25";
    profileWeightInput.max = unit === "lb" ? "551.2" : "250";
}
signupHeightUnit.value = unitPrefs.height; signupWeightUnit.value = unitPrefs.weight; signupPortionUnit.value = unitPrefs.portion;
applySignupHeightUnit(unitPrefs.height); applySignupWeightUnit(unitPrefs.weight);
profileHeightUnit.value = unitPrefs.height; profileWeightUnit.value = unitPrefs.weight; profilePortionUnit.value = unitPrefs.portion;
profileHeightUnit.addEventListener("change", () => {
    const old = unitPrefs.height; updateHeightInputForUnit(profileHeightInput, old, profileHeightUnit.value); updateHeightInputForUnit(signupHeightInput, old, profileHeightUnit.value);
    unitPrefs.height = profileHeightUnit.value; signupHeightUnit.value = unitPrefs.height; saveUnitPrefs(); persistUnitPreferences();
    document.getElementById("profile-height-label").textContent = `Height (${unitPrefs.height === "cm" ? "cm" : "ft/in"})`;
});
profilePortionUnit.addEventListener("change", () => {
    unitPrefs.portion = profilePortionUnit.value; signupPortionUnit.value = unitPrefs.portion; foodPortionUnit.value = unitPrefs.portion; saveUnitPrefs(); persistUnitPreferences(); renderRecognizedFoods(); loadFoodEntries();
});
profileWeightUnit.addEventListener("change", () => {
    const old = unitPrefs.weight; updateWeightInputForUnit(profileWeightInput, old, profileWeightUnit.value); updateWeightInputForUnit(signupWeightInput, old, profileWeightUnit.value); updateWeightInputForUnit(weightInput, old, profileWeightUnit.value);
    unitPrefs.weight = profileWeightUnit.value; signupWeightUnit.value = unitPrefs.weight; weightLogUnit.value = unitPrefs.weight; saveUnitPrefs(); persistUnitPreferences();
    document.getElementById("profile-weight-label").textContent = `Weight (${unitPrefs.weight})`;
    weightInput.min = unitPrefs.weight === "lb" ? "44.1" : "20"; weightInput.max = unitPrefs.weight === "lb" ? "1102.3" : "500";
    applySignupWeightUnit(unitPrefs.weight);
    loadWeights();
});
signupHeightUnit.addEventListener("change", () => {
    const old = unitPrefs.height; updateHeightInputForUnit(signupHeightInput, old, signupHeightUnit.value); updateHeightInputForUnit(profileHeightInput, old, signupHeightUnit.value);
    unitPrefs.height = signupHeightUnit.value; profileHeightUnit.value = unitPrefs.height; saveUnitPrefs(); applySignupHeightUnit(unitPrefs.height);
});
signupPortionUnit.addEventListener("change", () => {
    unitPrefs.portion = signupPortionUnit.value; profilePortionUnit.value = unitPrefs.portion; foodPortionUnit.value = unitPrefs.portion; saveUnitPrefs(); renderRecognizedFoods();
});
signupWeightUnit.addEventListener("change", () => {
    const old = unitPrefs.weight; updateWeightInputForUnit(signupWeightInput, old, signupWeightUnit.value); updateWeightInputForUnit(profileWeightInput, old, signupWeightUnit.value); updateWeightInputForUnit(weightInput, old, signupWeightUnit.value);
    unitPrefs.weight = signupWeightUnit.value; profileWeightUnit.value = unitPrefs.weight; weightLogUnit.value = unitPrefs.weight;
    weightInput.min = unitPrefs.weight === "lb" ? "44.1" : "20"; weightInput.max = unitPrefs.weight === "lb" ? "1102.3" : "500";
    saveUnitPrefs(); applySignupWeightUnit(unitPrefs.weight);
});
 document.querySelectorAll(".register-next").forEach(button => button.addEventListener("click", () => {
    const current = document.querySelector(`[data-register-step="${registerStepIndex}"]`);
    const fields = [...current.querySelectorAll("input, select")];
    for (const field of fields) {
        if (!field.checkValidity()) { field.reportValidity(); field.focus(); return; }
    }
    if (registerStepIndex === 0 && registrationPassword.value !== confirmRegistrationPassword.value) {
        showAuthMessage(registerMessage, "Passwords do not match."); confirmRegistrationPassword.focus(); return;
    }
    if (registerStepIndex === 1) {
        const cm = parseHeightCm(signupHeightInput.value, signupHeightUnit.value);
        const kg = signupWeightUnit.value === "lb" ? poundsToKg(signupWeightInput.value) : Number(signupWeightInput.value);
        if (!Number.isFinite(cm) || cm < 100 || cm > 230) { showAuthMessage(registerMessage, "Height must be 100–230 cm (or the equivalent feet/inches).", "error"); signupHeightInput.focus(); return; }
        if (!Number.isFinite(kg) || kg < 25 || kg > 250) { showAuthMessage(registerMessage, "Weight must be 25–250 kg (or the equivalent pounds).", "error"); signupWeightInput.focus(); return; }
    }
    showRegisterStep(Number(button.dataset.nextStep));
}));
document.querySelectorAll(".register-back").forEach(button => button.addEventListener("click", () => showRegisterStep(Number(button.dataset.backStep))));

document.getElementById("show-login").addEventListener("click", () => {
    openAuthForm("login");
});

// The legacy show-register button was removed from HTML; do not bind to a missing element.
// Registration is opened by the landing button and the show-register link is delegated if present.
const showRegisterButton = document.getElementById("show-register");
if (showRegisterButton) showRegisterButton.addEventListener("click", () => openAuthForm("register"));

document.getElementById("back-to-welcome").addEventListener("click", () => {
    authSection.hidden = true;
    landingSection.hidden = false;
    landingSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

const TOKEN_KEY = "calorieCompassToken";

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
    return {
        Authorization: `Bearer ${getToken()}`
    };
}

async function persistUnitPreferences() {
    if (!getToken()) return;
    try {
        await fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ height_unit: unitPrefs.height, weight_unit: unitPrefs.weight, portion_unit: unitPrefs.portion })
        });
    } catch (error) { console.warn("Could not sync unit preferences."); }
}

function showAuthMessage(element, message, type = "error") {
    element.textContent = message;
    element.className = `message ${type}`;
}

function setLoggedInUI(loggedIn) {
    authSection.hidden = true;
    landingSection.hidden = loggedIn;
    profileSection.hidden = !loggedIn;
    document.querySelector(".intro").hidden = !loggedIn;
    document.querySelector(".capture-panel").hidden = true;
    document.querySelector(".results-panel").hidden = true;
    document.querySelector(".diary-panel").hidden = true;
    document.querySelector(".activity-panel").hidden = true;
    document.querySelector(".weight-panel").hidden = true;
    document.querySelector(".footer-note").hidden = !loggedIn;
    const nav=document.getElementById("app-navigation"); if(nav) nav.hidden=!loggedIn;
    if(loggedIn) showAppScreen(currentAppScreen === "profile" ? "home" : currentAppScreen);
    else saveDock.hidden=true;
}

async function loadProfile() {
    const response = await fetch("/api/profile", {
        headers: authHeaders()
    });

    if (!response.ok) {
        throw new Error("Session expired. Please log in again.");
    }

    const result = await response.json();
    const user = result.user || result;
    dashboardUser = user;

    document.getElementById("profile-name").value = user.full_name || "";
    document.getElementById("profile-age").value = user.age || "";
    unitPrefs = { height: user.height_unit || "cm", weight: user.weight_unit || "kg", portion: user.portion_unit || "g" };
    saveUnitPrefs();
    signupHeightUnit.value = unitPrefs.height; signupWeightUnit.value = unitPrefs.weight; signupPortionUnit.value = unitPrefs.portion;
    profileHeightUnit.value = unitPrefs.height; profileWeightUnit.value = unitPrefs.weight; profilePortionUnit.value = unitPrefs.portion;
    foodPortionUnit.value = unitPrefs.portion; weightLogUnit.value = unitPrefs.weight;
    weightLogLabel.textContent = `Weight (${unitPrefs.weight})`;
    weightInput.min = unitPrefs.weight === "lb" ? "44.1" : "20"; weightInput.max = unitPrefs.weight === "lb" ? "1102.3" : "500";
    applySignupHeightUnit(unitPrefs.height); applySignupWeightUnit(unitPrefs.weight);
    document.getElementById("profile-height-label").textContent = `Height (${unitPrefs.height === "cm" ? "cm" : "ft/in"})`;
    document.getElementById("profile-height").value = formatHeight(user.height_cm, unitPrefs.height);
    document.getElementById("profile-weight-label").textContent = `Weight (${unitPrefs.weight})`;
    document.getElementById("profile-weight").value = unitPrefs.weight === "lb" ? kgToPounds(user.weight_kg).toFixed(1) : user.weight_kg || "";
    currentWeightKg = Number(user.weight_kg) || 0;
    document.getElementById("profile-activity").value = user.activity_level || "sedentary";
    document.getElementById("profile-goal").value = user.goal || "maintain";

    document.getElementById("profile-name-heading").textContent =
        `Hello, ${user.full_name || "User"}!`;

    setLoggedInUI(true);
    await Promise.all([loadFoodEntries(), loadActivities(), loadWeights(), loadHomeCalorieDashboard(user)]);
}

async function loadHomeCalorieDashboard(user) {
    const intake = document.getElementById("home-intake");
    const targetWrap = document.getElementById("home-target-wrap");
    const remainingWrap = document.getElementById("home-remaining-wrap");
    const targetText = document.getElementById("home-target");
    const remainingText = document.getElementById("home-remaining");
    const progress = document.getElementById("home-progress");
    const note = document.getElementById("home-target-note");
    const today = getLocalDateString();
    let consumed = 0;
    try {
        const response = await fetch(
            `/api/food-entries/summary?date=${encodeURIComponent(today)}`,
            { headers: authHeaders() }
        );

        if (response.ok) {
            const summary = await response.json();
            consumed = Number(summary.total_calories) || 0;
            intake.textContent = `${Math.round(consumed)} kcal`;
        } else {
            intake.textContent = "— kcal";
        }
    } catch (error) {
        console.error("Dashboard calorie summary error:", error);
        intake.textContent = "— kcal";
    }
    const age = Number(user.age), height = Number(user.height_cm), weight = Number(user.weight_kg);
    if (age < 18 || !Number.isFinite(age) || !Number.isFinite(height) || !Number.isFinite(weight) || weight <= 0 || height <= 0) {
        targetWrap.hidden = true; remainingWrap.hidden = true; progress.parentElement.hidden = true;
        note.textContent = "Daily calorie target estimates are not shown for users under 18. Food totals remain estimates.";
        return;
    }
    const activityFactors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
    const factor = activityFactors[user.activity_level] || 1.2;
    // Sex-neutral rough estimate; not intended as a prescription.
    const bmr = 10 * weight + 6.25 * height - 5 * age - 78.5;
    let target = bmr * factor;
    if (user.goal === "lose") target -= 300;
    if (user.goal === "gain") target += 200;
    target = Math.round(target);
    if (target < 1200 || target > 5000) {
        targetWrap.hidden = true; remainingWrap.hidden = true; progress.parentElement.hidden = true;
        note.textContent = "A daily target estimate is not shown for this profile. Please consult a qualified professional for personalized guidance.";
        return;
    }
    targetText.textContent = `${target} kcal`;
    targetWrap.hidden = false; remainingWrap.hidden = false; progress.parentElement.hidden = false;
    const remaining = target - consumed;
    remainingText.textContent = remaining >= 0 ? `${remaining} kcal` : `${Math.abs(remaining)} kcal over`;
    const percent = Math.min(100, target > 0 ? consumed / target * 100 : 0);
    progress.style.width = `${percent}%`;
    note.textContent = "Rough adult estimate using profile data. Not medical advice; needs individual review.";
}
async function refreshHomeCalorieDashboard() {
    if (!dashboardUser) return;

    await loadHomeCalorieDashboard(dashboardUser);
}

// REGISTER
registerForm.addEventListener("submit", async event => {
    event.preventDefault();

    const password = registrationPassword.value;
    const confirmPassword = confirmRegistrationPassword.value;
    const passwordIsValid = Object.values(passwordRuleChecks).every(check => check(password));

    if (!passwordIsValid) {
        showAuthMessage(registerMessage, "Please meet all password requirements.");
        registrationPassword.focus();
        return;
    }
    if (password !== confirmPassword) {
        showAuthMessage(registerMessage, "Passwords do not match.");
        confirmRegistrationPassword.focus();
        return;
    }

    showAuthMessage(registerMessage, "Creating account...", "success");

    const payload = {
        full_name: document.getElementById("full_name").value.trim(),
        email: document.getElementById("register-email").value.trim().toLowerCase(),
        password: registrationPassword.value,
        confirm_password: confirmPassword,
        age: Number(document.getElementById("age").value),
        height_cm: parseHeightCm(document.getElementById("height_cm").value, document.getElementById("register-height-unit").value),
        weight_kg: document.getElementById("register-weight-unit").value === "lb" ? poundsToKg(document.getElementById("weight_kg").value) : Number(document.getElementById("weight_kg").value),
        activity_level: document.getElementById("activity_level").value,
        goal: document.getElementById("goal").value,
        height_unit: signupHeightUnit.value,
        weight_unit: signupWeightUnit.value,
        portion_unit: signupPortionUnit.value
    };

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Registration failed.");
        }

        pendingVerificationEmail = payload.email;
        document.getElementById("register-form").hidden = true;
        document.getElementById("login-form").hidden = true;
        document.getElementById("verification-panel").hidden = false;

        showAuthMessage(
            document.getElementById("verification-message"),
            "Account created! Check your inbox for your 6-digit code.",
            "success"
        );
        startVerificationResendTimer();
    } catch (error) {
        // Registration can create the user before SMTP fails. Keep the verification/resend panel accessible.
        if (error.message && /account created/i.test(error.message)) {
            pendingVerificationEmail = payload.email;
            registerForm.hidden = true;
            loginForm.hidden = true;
            verificationPanel.hidden = false;
            showAuthMessage(verificationMessage, error.message, "error");
            startVerificationResendTimer();
        } else {
            showAuthMessage(registerMessage, error.message);
        }
    }
});

const verificationPanel = document.getElementById("verification-panel");
const verificationMessage = document.getElementById("verification-message");

document.getElementById("verify-email-button").addEventListener("click", async () => {
    const code = document.getElementById("verification-code").value.trim();

    if (!/^\d{6}$/.test(code)) {
        showAuthMessage(verificationMessage, "Enter a valid 6-digit code.");
        return;
    }

    try {
        const response = await fetch("/api/auth/verify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: pendingVerificationEmail,
                code
            })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.message);

        verificationPanel.hidden = true;
        registerForm.hidden = true;
        loginForm.hidden = false;
        forgotPanel.hidden = true;
        document.getElementById("auth-title").textContent = "Email verified!";
        document.getElementById("auth-subtitle").textContent = "Your account is ready. Log in to open your dashboard.";

        document.getElementById("login-email").value = pendingVerificationEmail;

        showAuthMessage(loginMessage, "Email verified! You can now log in.", "success");
        document.getElementById("login-email").focus();

    } catch (error) {
        showAuthMessage(verificationMessage, error.message);
    }
});

function startVerificationResendTimer() {
    clearInterval(verificationResendTimer);
    verificationResendCountdown = 60;
    const button = document.getElementById("resend-verification-button");
    const timerLabel = document.getElementById("resend-verification-timer");
    const loginResendButton = document.getElementById("login-resend-verification");
    button.disabled = true;
    function tick() {
        timerLabel.textContent = verificationResendCountdown > 0 ? `Resend available in ${verificationResendCountdown}s` : "You can resend the code now.";
        button.disabled = verificationResendCountdown > 0;
        if (loginResendButton) loginResendButton.disabled = verificationResendCountdown > 0;
        if (verificationResendCountdown <= 0) { clearInterval(verificationResendTimer); return; }
        verificationResendCountdown--;
    }
    tick();
    verificationResendTimer = setInterval(tick, 1000);
}

document.getElementById("resend-verification-button").addEventListener("click", async () => {
    const button = document.getElementById("resend-verification-button");

    if (!pendingVerificationEmail) return;

    button.disabled = true;

    try {
        const response = await fetch("/api/auth/resend-verification", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: pendingVerificationEmail })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.message);

        showAuthMessage(verificationMessage, result.message, "success");
        startVerificationResendTimer();
    } catch (error) {
        showAuthMessage(verificationMessage, error.message);
        button.disabled = false;
    }
});

const loginResendVerificationButton = document.getElementById("login-resend-verification");
loginResendVerificationButton.addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAuthMessage(loginMessage, "Enter your account email first."); return;
    }
    loginResendVerificationButton.disabled = true;
    try {
        const response = await fetch("/api/auth/resend-verification", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not resend code.");
        pendingVerificationEmail = email;
        loginForm.hidden = true; registerForm.hidden = true; verificationPanel.hidden = false; forgotPanel.hidden = true;
        showAuthMessage(verificationMessage, result.message, "success");
        startVerificationResendTimer();
    } catch (error) {
        showAuthMessage(loginMessage, error.message || "Could not resend code.");
    } finally {
        loginResendVerificationButton.disabled = false;
    }
});

const forgotPanel = document.getElementById("forgot-panel");
const forgotMessage = document.getElementById("forgot-message");

function showForgotStep(step) {
    document.getElementById("forgot-step-email").hidden = step !== "email";
    document.getElementById("forgot-step-code").hidden = step !== "code";
    document.getElementById("forgot-step-password").hidden = step !== "password";
    document.getElementById("forgot-step-success").hidden = step !== "success";

    const titles = {
        email: "Reset your password",
        code: "Check your email",
        password: "Create a new password",
        success: "Password changed"
    };

    document.getElementById("forgot-title").textContent = titles[step];
}

function openForgotPassword() {
    passwordResetToken = "";
    registerForm.hidden = true;
    loginForm.hidden = true;
    verificationPanel.hidden = true;
    forgotPanel.hidden = false;

    showForgotStep("email");
    showAuthMessage(forgotMessage, "");

    document.getElementById("forgot-email").value =
        document.getElementById("login-email").value.trim();

    forgotPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("forgot-password-button").addEventListener("click", openForgotPassword);

document.getElementById("forgot-back-login").addEventListener("click", () => {
    passwordResetToken = "";
    forgotPanel.hidden = true;
    loginForm.hidden = false;
    registerForm.hidden = true;
});

document.getElementById("forgot-send-code").addEventListener("click", async () => {
    const email = document.getElementById("forgot-email").value.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAuthMessage(forgotMessage, "Enter a valid email address.");
        return;
    }

    try {
        const response = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.message);

        document.getElementById("forgot-email").dataset.email = email;

        showForgotStep("code");
        showAuthMessage(forgotMessage, result.message, "success");
        startResetResendTimer();

    } catch (error) {
        showAuthMessage(forgotMessage, error.message);
    }
});

async function verifyResetCode() {
    const email = document.getElementById("forgot-email").dataset.email;
    const code = document.getElementById("reset-code").value.trim();

    if (!/^\d{6}$/.test(code)) {
        showAuthMessage(forgotMessage, "Enter the 6-digit code.");
        return;
    }

    try {
        const response = await fetch("/api/auth/verify-reset-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.message);

        passwordResetToken = result.resetToken;
        showForgotStep("password");

    } catch (error) {
        showAuthMessage(forgotMessage, error.message);
    }
}

document.getElementById("forgot-verify-code")
    .addEventListener("click", verifyResetCode);

// Resend reset code
document.getElementById("forgot-resend-code").addEventListener("click", async () => {
    if (resendCountdown > 0) return;
    const email = document.getElementById("forgot-email").dataset.email;

    try {
        const response = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Could not resend code.");
        }

        showAuthMessage(forgotMessage, result.message, "success");
        startResetResendTimer();

    } catch {
        showAuthMessage(forgotMessage, "Could not resend code. Try again.");
    }
});

// 60-second resend countdown
function startResetResendTimer() {
    clearInterval(resendTimer);
    resendCountdown = 60;

    const button = document.getElementById("forgot-resend-code");
    const timerLabel = document.getElementById("reset-resend-timer");

    button.disabled = true;

    function updateTimer() {
        timerLabel.textContent = resendCountdown > 0
            ? `Resend available in ${resendCountdown}s`
            : "You can resend the code now.";

        button.disabled = resendCountdown > 0;

        if (resendCountdown <= 0) {
            clearInterval(resendTimer);
            return;
        }

        resendCountdown--;
    }

    updateTimer();
    resendTimer = setInterval(updateTimer, 1000);
}

// Password rules for reset
const resetPasswordInput = document.getElementById("reset-password");
const resetConfirmInput = document.getElementById("reset-confirm-password");

resetPasswordInput.addEventListener("input", () => {
    Object.entries(passwordRuleChecks).forEach(([rule, check]) => {
        const item = document.querySelector(`[data-reset-rule="${rule}"]`);
        item.classList.toggle("passed", check(resetPasswordInput.value));
    });
});

// Save new password
document.getElementById("reset-password-button").addEventListener("click", async () => {
    const password = resetPasswordInput.value;
    const confirmPassword = resetConfirmInput.value;

    const valid = Object.values(passwordRuleChecks).every(check => check(password));

    if (!valid) {
        showAuthMessage(forgotMessage, "Please meet all password requirements.");
        return;
    }

    if (password !== confirmPassword) {
        showAuthMessage(forgotMessage, "Passwords do not match.");
        return;
    }

    try {
        const response = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                resetToken: passwordResetToken,
                password,
                confirm_password: confirmPassword
            })
        });

        const result = await response.json();

        if (!response.ok) throw new Error(result.message);

        passwordResetToken = "";
        resetPasswordInput.value = "";
        resetConfirmInput.value = "";

        showForgotStep("success");
        showAuthMessage(forgotMessage, result.message, "success");

    } catch (error) {
        showAuthMessage(forgotMessage, error.message);
    }
});

// Return to login after successful reset
document.getElementById("reset-back-login").addEventListener("click", () => {
    forgotPanel.hidden = true;
    registerForm.hidden = true;
    loginForm.hidden = false;

    document.getElementById("login-email").value =
        document.getElementById("forgot-email").dataset.email || "";

    showAuthMessage(loginMessage, "Password updated. Please log in.", "success");
});

// LOGIN
loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    showAuthMessage(loginMessage, "Signing in...", "success");

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: document.getElementById("login-email").value.trim(),
                password: document.getElementById("login-password").value
            })
        });

        const result = await response.json();

        if (!response.ok) {
            if (response.status === 403 && /verify your email/i.test(result.message || "")) {
                loginResendVerificationButton.hidden = false;
            }
            throw new Error(result.message || "Login failed.");
        }

        loginResendVerificationButton.hidden = true;
        localStorage.setItem(TOKEN_KEY, result.token);
        document.getElementById("login-password").value = "";
        currentAppScreen = "home";
        await loadProfile();
    } catch (error) {
        showAuthMessage(loginMessage, error.message);
    }
});

// UPDATE PROFILE
profileForm.addEventListener("submit", async event => {
    event.preventDefault();

    const profileCm = parseHeightCm(profileHeightInput.value, profileHeightUnit.value);
    const profileKg = profileWeightUnit.value === "lb" ? poundsToKg(profileWeightInput.value) : Number(profileWeightInput.value);
    if (!Number.isFinite(profileCm) || profileCm < 100 || profileCm > 230) { showAuthMessage(profileMessage, "Height must be 100–230 cm."); profileHeightInput.focus(); return; }
    if (!Number.isFinite(profileKg) || profileKg < 25 || profileKg > 250) { showAuthMessage(profileMessage, "Weight must be 25–250 kg."); profileWeightInput.focus(); return; }
    const payload = {
        full_name: document.getElementById("profile-name").value.trim(),
        age: Number(document.getElementById("profile-age").value),
        height_cm: parseHeightCm(document.getElementById("profile-height").value, document.getElementById("profile-height-unit").value),
        weight_kg: document.getElementById("profile-weight-unit").value === "lb" ? poundsToKg(document.getElementById("profile-weight").value) : Number(document.getElementById("profile-weight").value),
        activity_level: document.getElementById("profile-activity").value,
        goal: document.getElementById("profile-goal").value,
        height_unit: profileHeightUnit.value,
        weight_unit: profileWeightUnit.value,
        portion_unit: profilePortionUnit.value
    };

    try {
        const response = await fetch("/api/profile", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                ...authHeaders()
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Profile update failed.");
        }

        currentWeightKg = payload.weight_kg;
        unitPrefs = { height: payload.height_unit, weight: payload.weight_unit, portion: payload.portion_unit };
        signupHeightUnit.value = unitPrefs.height; signupWeightUnit.value = unitPrefs.weight; signupPortionUnit.value = unitPrefs.portion;
        foodPortionUnit.value = unitPrefs.portion; weightLogUnit.value = unitPrefs.weight; saveUnitPrefs();
        showAuthMessage(profileMessage, "Profile updated successfully!", "success");
        updateActivityPreview();
        await loadWeights();

        document.getElementById("profile-name-heading").textContent =
            `Hello, ${payload.full_name}!`;

    } catch (error) {
        showAuthMessage(profileMessage, error.message);
    }
});

// LOGOUT
logoutButton.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    setLoggedInUI(false);
    showAuthMessage(loginMessage, "You have logged out.", "success");
});

// INITIAL SESSION
document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) {
        setLoggedInUI(false);
        return;
    }

    try {
        await loadProfile();
    } catch (error) {
        localStorage.removeItem(TOKEN_KEY);
        setLoggedInUI(false);
    }
});

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
const foodPortionUnit = document.getElementById("food-portion-unit");
const mealTypeSelect = document.getElementById("meal-type-select");
const MANUAL_FOOD_ESTIMATES = {
    "steamed rice": { kcalPer100: 130, grams: 150 }, "polao": { kcalPer100: 180, grams: 180 },
    "dal": { kcalPer100: 116, grams: 150 }, "roti": { kcalPer100: 297, grams: 60 },
    "chicken curry": { kcalPer100: 160, grams: 180 }, "vegetable bhaji": { kcalPer100: 100, grams: 100 },
    "latte": { kcalPer100: 60, grams: 240 }, "cookies": { kcalPer100: 480, grams: 30 },
    "biscuit": { kcalPer100: 450, grams: 30 }, "cappuccino": { kcalPer100: 40, grams: 240 }
};
foodPortionUnit.value = unitPrefs.portion;
foodPortionUnit.addEventListener("change", () => { unitPrefs.portion = foodPortionUnit.value; signupPortionUnit.value = unitPrefs.portion; profilePortionUnit.value = unitPrefs.portion; saveUnitPrefs(); persistUnitPreferences(); renderRecognizedFoods(); loadFoodEntries(); });
const addManualFoodBtn = document.getElementById("addManualFoodBtn");
const foodEntries = document.getElementById("foodEntries");
const refreshBtn = document.getElementById("refreshBtn");
const diaryDateFilter = document.getElementById("diary-date-filter");
const diarySummary = document.getElementById("diary-summary");
const diaryClearDate = document.getElementById("diary-clear-date");
diaryDateFilter.value = getLocalDateString();
diaryDateFilter.addEventListener("change", () => loadFoodEntries(diaryDateFilter.value));
diaryClearDate.addEventListener("click", () => { diaryDateFilter.value = ""; loadFoodEntries(""); });
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
        clearSelectedImage();
        showMessage("Please choose a JPEG, PNG, or WEBP image.", "error");
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        clearSelectedImage();
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
    recognizedFoods = [];
    renderRecognizedFoods();
    updateSaveDock();
    fallbackPanel.hidden = false;
    manualFoodSearch.value = "";
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
    recognizedFoods = [];
    recognitionResults.innerHTML = "";
    emptyResults.hidden = true;
    updateSaveDock();
    fallbackPanel.hidden = true;
    showMessage("");

    const formData = new FormData();
    formData.append("foodImage", selectedImage);

    try {
        const response = await fetch("/api/recognize-food", {
            method: "POST",
            headers: authHeaders(),
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
        // Keep manual entry available even when AI confidence is high.
        fallbackPanel.hidden = false;

        showMessage(
            `Found ${recognizedFoods.length} food item(s). Review the names and estimates before saving.`,
            "success"
        );
    } catch (error) {
        console.error("Food recognition error:", error);
        recognizedFoods = [];
        renderRecognizedFoods();
        fallbackPanel.hidden = false;
        showMessage(
            `${error.message || "Recognition failed."} You can use the manual food entry below.`,
            "error"
        );
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

        const portionUnit = unitPrefs.portion;
        const displayPortion = portionUnit === "oz" ? gramsToOunces(item.grams || 0) : Number(item.grams || 0);
        const gramsField = createField(`Portion (${portionUnit})`, "number", item.grams === "" ? "" : displayPortion.toFixed(portionUnit === "oz" ? 2 : 0), portionUnit === "oz" ? "e.g. 5.3" : "e.g. 150");
        const portionControls = document.createElement("div");
        portionControls.className = "portion-stepper";
        const minusPortion = document.createElement("button");
        minusPortion.type = "button";
        minusPortion.textContent = portionUnit === "oz" ? "− 0.9 oz" : "− 25 g";
        minusPortion.setAttribute("aria-label", "Decrease portion by 25 grams");
        const plusPortion = document.createElement("button");
        plusPortion.type = "button";
        plusPortion.textContent = portionUnit === "oz" ? "+ 0.9 oz" : "+ 25 g";
        plusPortion.setAttribute("aria-label", "Increase portion by 25 grams");
        const adjustPortion = delta => {
            const entered = Number(gramsField.input.value || 0);
            const currentGrams = portionUnit === "oz" ? ouncesToGrams(entered) : entered;
            const nextGrams = Math.max(0, currentGrams + delta);
            gramsField.input.value = portionUnit === "oz" ? gramsToOunces(nextGrams).toFixed(2) : Math.round(nextGrams);
            gramsField.input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        minusPortion.addEventListener("click", () => adjustPortion(-25));
        plusPortion.addEventListener("click", () => adjustPortion(25));
        portionControls.append(minusPortion, plusPortion);
        gramsField.wrapper.appendChild(portionControls);
        gramsField.input.min = portionUnit === "oz" ? String(1 / 28.3495) : "1";
        gramsField.input.max = portionUnit === "oz" ? String(5000 / 28.3495) : "5000";
        gramsField.input.step = portionUnit === "oz" ? "0.1" : "1";
        gramsField.input.addEventListener("input", () => {
            const raw = Number(gramsField.input.value);
            item.grams = portionUnit === "oz" ? ouncesToGrams(raw) : raw;
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

document.querySelectorAll(".suggestion-chip[data-food]").forEach(button => {
    button.addEventListener("click", () => {
        manualFoodSearch.value = button.dataset.food;
        manualFoodSearch.focus();
    });
});
manualFoodSearch.addEventListener("input", () => {
    const term = manualFoodSearch.value.trim().toLowerCase();
    document.querySelectorAll(".suggestion-chip[data-food]").forEach(button => {
        button.hidden = Boolean(term) && !button.dataset.food.toLowerCase().includes(term);
    });
});

addManualFoodBtn.addEventListener("click", () => {
    const name = manualFoodSearch.value.trim();

    if (!name) {
        manualFoodSearch.focus();
        return;
    }

    const estimate = MANUAL_FOOD_ESTIMATES[name.toLowerCase()] || null;
    recognizedFoods.push({
        name,
        grams: estimate ? estimate.grams : "",
        caloriesPer100: estimate ? estimate.kcalPer100 : "",
        confidence: 0,
        notes: estimate ? "Rough local reference estimate. Please verify and adjust." : "Manually entered. Add a portion and verify calories per 100 g."
    });

    renderRecognizedFoods();
    fallbackPanel.hidden = false;
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
    await refreshHomeCalorieDashboard();

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

    
    const response = await fetch("/api/food-entries", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeaders()
        },
        body: JSON.stringify({
            food_name: item.name.trim(),
            portion: Number(item.grams),
            calories: Number(calories.toFixed(2)),
            meal_type: mealTypeSelect.value,
            entry_date: getLocalDateString()
        })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.message || `Could not save ${item.name}.`);
    }

}

// --------------------------------------------------
// FOOD DIARY
// --------------------------------------------------

async function loadFoodEntries(date = diaryDateFilter.value) {
    foodEntries.innerHTML = '<div class="diary-loading"><span class="spinner small"></span> Loading your diary...</div>';
    diarySummary.textContent = "Loading summary...";
    try {
        const url = date ? `/api/food-entries?date=${encodeURIComponent(date)}` : "/api/food-entries";
        const response = await fetch(url, { headers: authHeaders() });


        if (!response.ok) {
            throw new Error("Failed to retrieve food entries.");
        }

        const entries = await response.json();
        foodEntries.innerHTML = "";

        if (!Array.isArray(entries) || entries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "diary-empty";
            empty.textContent = date ? "No food entries on this date." : "No food entries yet. Your saved meals will appear here.";
            foodEntries.appendChild(empty);
            diarySummary.textContent = date ? `Total for ${date}: 0 entries · 0 kcal` : "No food entries yet.";
            return;
        }
        const totalCalories = entries.reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
        if (date) {
            try {
                const summaryResponse = await fetch(`/api/food-entries/summary?date=${encodeURIComponent(date)}`, { headers: authHeaders() });
                const summaryData = summaryResponse.ok ? await summaryResponse.json() : null;
                diarySummary.textContent = `Total for ${date}: ${Number(summaryData?.total_entries ?? entries.length)} entries · ${Math.round(Number(summaryData?.total_calories ?? totalCalories))} kcal`;
            } catch { diarySummary.textContent = `Total for ${date}: ${entries.length} entries · ${Math.round(totalCalories)} kcal`; }
        } else {
            diarySummary.textContent = `All entries: ${entries.length} entries · ${Math.round(totalCalories)} kcal`;
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
            const shownPortion = unitPrefs.portion === "oz" ? `${gramsToOunces(entry.portion_grams).toFixed(2)} oz` : `${Number(entry.portion_grams).toFixed(0)} g`;
            details.textContent = `${shownPortion} · ${entry.meal_type || "Unspecified"}`;

            const date = document.createElement("time");
            const entryDateValue = entry.entry_date instanceof Date ? getLocalDateString(entry.entry_date) : String(entry.entry_date || "").slice(0, 10);
            date.textContent = entryDateValue ? `Date: ${entryDateValue}` : "";

            info.append(name, details, date);

            const calories = document.createElement("div");
            calories.className = "diary-calories";

            const calorieValue = document.createElement("strong");
            calorieValue.textContent = Number(entry.calories).toFixed(0);

            const calorieLabel = document.createElement("span");
            calorieLabel.textContent = "kcal";

            calories.append(calorieValue, calorieLabel);

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "edit-entry-button";
            editButton.textContent = "Edit";
            editButton.setAttribute("aria-label", `Edit ${entry.food_name}`);
            editButton.addEventListener("click", () => editFoodEntry(entry));

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

            row.append(thumbnail, info, calories, editButton, deleteButton);
            foodEntries.appendChild(row);
        });
    } catch (error) {
        console.error("Load food entries error:", error);
        foodEntries.innerHTML = '<div class="diary-error">Could not load your diary. Please try refreshing.</div>';
    }
}

async function editFoodEntry(entry) {
    const newName = prompt("Food name:", entry.food_name || "");
    if (newName === null) return;
    const currentPortionGrams = Number(entry.portion_grams);
    const currentDisplayPortion = unitPrefs.portion === "oz" ? gramsToOunces(currentPortionGrams).toFixed(2) : currentPortionGrams;
    const portionText = prompt(`Portion (${unitPrefs.portion}):`, String(currentDisplayPortion));
    if (portionText === null) return;
    const portion = unitPrefs.portion === "oz" ? ouncesToGrams(Number(portionText)) : Number(portionText);
    const calorieText = prompt("Total calories (kcal):", String(Number(entry.calories).toFixed(0)));
    if (calorieText === null) return;
    const calories = Number(calorieText);
    const rawEntryDate = entry.entry_date;
    const defaultEntryDate = rawEntryDate instanceof Date ? getLocalDateString(rawEntryDate) : String(rawEntryDate).slice(0, 10);
    const dateText = prompt("Entry date (YYYY-MM-DD):", defaultEntryDate);
    if (dateText === null) return;
    const mealType = prompt("Meal type (Breakfast, Lunch, Dinner, Snack, Unspecified):", entry.meal_type || "Unspecified");
    if (mealType === null) return;
    const allowedMeals = ["Breakfast", "Lunch", "Dinner", "Snack", "Unspecified"];
    if (!allowedMeals.includes(mealType) || !newName.trim() || newName.trim().length > 150 || !Number.isFinite(portion) || portion <= 0 || portion > 5000 || !Number.isFinite(calories) || calories <= 0 || calories > 50000 || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        alert("Please enter a food name, valid portion, total calories, and date.");
        return;
    }
    try {
        const response = await fetch(`/api/food-entries/${encodeURIComponent(entry.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ food_name: newName.trim(), meal_type: mealType, portion, calories, entry_date: dateText })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not update entry.");
        showToast("Food entry updated");
        await loadFoodEntries(diaryDateFilter.value);
        await refreshHomeCalorieDashboard();
    } catch (error) { alert(error.message || "Could not update food entry."); }
}


async function deleteFoodEntry(id) {
    
    const response = await fetch(`/api/food-entries/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders()
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
    await refreshHomeCalorieDashboard();
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

// Initial render only; diary data loads after a valid session is established.
renderRecognizedFoods();
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
let currentWeightKg = 0;

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
    const met = Number(selectedOption?.dataset.rate || 5.5);
    const bodyWeight = currentWeightKg > 0 ? currentWeightKg : 70;
    // Standard MET-based approximation: MET × 3.5 × kg / 200 × minutes.
    return Math.round(met * 3.5 * bodyWeight / 200 * minutes);
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
            headers: { "Content-Type": "application/json", ...authHeaders() },
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
        const response = await fetch("/api/activities", { headers: authHeaders() });
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
                    const res = await fetch(`/api/activities/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: authHeaders() });
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
        activityEntries.innerHTML = '<div class="diary-error">Could not load activities. Please refresh and try again.</div>';
    }
}

// --------------------------------------------------
// WEIGHT & PROGRESS TRACKING (NAILA)
// --------------------------------------------------

const weightInput = document.getElementById("weightInput");
const weightLogUnit = document.getElementById("weight-log-unit");
const weightLogLabel = document.getElementById("weight-log-label");
weightLogUnit.value = unitPrefs.weight;
weightLogLabel.textContent = `Weight (${unitPrefs.weight})`;
weightInput.min = unitPrefs.weight === "lb" ? "44.1" : "20";
weightInput.max = unitPrefs.weight === "lb" ? "1102.3" : "500";
applySignupWeightUnit(unitPrefs.weight);
weightLogUnit.addEventListener("change", () => {
    const old = unitPrefs.weight; updateWeightInputForUnit(weightInput, old, weightLogUnit.value); updateWeightInputForUnit(profileWeightInput, old, weightLogUnit.value); updateWeightInputForUnit(signupWeightInput, old, weightLogUnit.value);
    unitPrefs.weight = weightLogUnit.value; profileWeightUnit.value = unitPrefs.weight; signupWeightUnit.value = unitPrefs.weight;
    weightInput.min = unitPrefs.weight === "lb" ? "44.1" : "20";
    weightInput.max = unitPrefs.weight === "lb" ? "1102.3" : "500";
    applySignupWeightUnit(unitPrefs.weight);
    saveUnitPrefs(); persistUnitPreferences(); weightLogLabel.textContent = `Weight (${unitPrefs.weight})`;
    loadWeights();
});
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
    const enteredWeight = Number(weightInput.value);
    const weightKg = unitPrefs.weight === "lb" ? poundsToKg(enteredWeight) : enteredWeight;
    const note = weightNoteInput.value.trim();

    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 500) {
        showWeightMessage(`Please enter a valid weight between ${unitPrefs.weight === "lb" ? "44.1" : "20"} and ${unitPrefs.weight === "lb" ? "1102.3 lb" : "500 kg"}.`, "error");
        weightInput.focus();
        return;
    }

    saveWeightBtn.disabled = true;
    showWeightMessage("");

    try {
        const response = await fetch("/api/weights", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
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
        const shownWeight = unitPrefs.weight === "lb" ? kgToPounds(Number(item.weight_kg)) : Number(item.weight_kg);
        return { x, y, weight: shownWeight.toFixed(1), unit: unitPrefs.weight };
    });

    const polylinePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const circles = points
        .map(
            p => `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#2f6f4e" />
            <text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" font-size="11" fill="#243127" font-weight="600">${p.weight} ${p.unit}</text>
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
        const response = await fetch("/api/weights", { headers: authHeaders() });
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

        const shownStart = unitPrefs.weight === "lb" ? kgToPounds(startWeight) : startWeight;
        const shownLatest = unitPrefs.weight === "lb" ? kgToPounds(latestWeight) : latestWeight;
        const shownDiff = unitPrefs.weight === "lb" ? kgToPounds(diff) : diff;
        const weightUnitText = unitPrefs.weight;
        startWeightStat.textContent = `${shownStart.toFixed(1)} ${weightUnitText}`;
        latestWeightStat.textContent = `${shownLatest.toFixed(1)} ${weightUnitText}`;
        changeWeightStat.textContent = `${shownDiff > 0 ? "+" : ""}${shownDiff.toFixed(1)} ${weightUnitText}`;

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
            const displayWeight = unitPrefs.weight === "lb" ? kgToPounds(Number(item.weight_kg)) : Number(item.weight_kg);
            title.textContent = `${displayWeight.toFixed(1)} ${unitPrefs.weight}`;

            const note = document.createElement("span");
            note.textContent = item.note || "Weight check-in";

            const date = document.createElement("time");
            const parsedDate = new Date(item.created_at);
            date.textContent = Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toLocaleString();

            info.append(title, note, date);

            const badge = document.createElement("div");
            badge.className = "diary-calories";
            badge.innerHTML = `<strong>${displayWeight.toFixed(1)}</strong><span>${unitPrefs.weight}</span>`;

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "delete-button";
            deleteBtn.title = "Delete weight entry";
            deleteBtn.innerHTML = '<svg class="icon"><use href="#i-trash"></use></svg>';
            deleteBtn.addEventListener("click", async () => {
                if (!confirm(`Delete weight entry (${Number(item.weight_kg).toFixed(1)} kg)?`)) return;
                deleteBtn.disabled = true;
                try {
                    const res = await fetch(`/api/weights/${encodeURIComponent(item.id)}`, { method: "DELETE", headers: authHeaders() });
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
        weightEntries.innerHTML = '<div class="diary-error">Could not load weight history. Please refresh and try again.</div>';
        weightChartContainer.innerHTML = '<p class="diary-error">Your progress chart could not be loaded.</p>';
    }
}

updateActivityPreview();
