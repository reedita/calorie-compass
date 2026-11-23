CREATE DATABASE IF NOT EXISTS calorie_compass CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE calorie_compass;

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    age TINYINT UNSIGNED NOT NULL,
    height_cm DECIMAL(5,2) NOT NULL,
    weight_kg DECIMAL(5,2) NOT NULL,
    activity_level ENUM('sedentary','light','moderate','active') NOT NULL,
    goal ENUM('lose','maintain','gain') NOT NULL,
    height_unit VARCHAR(5) NOT NULL DEFAULT 'cm',
    weight_unit VARCHAR(2) NOT NULL DEFAULT 'kg',
    portion_unit VARCHAR(2) NOT NULL DEFAULT 'g',
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS auth_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(20) NOT NULL,
    expires_at DATETIME NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_email_purpose (email, purpose, used, expires_at)
);


CREATE TABLE IF NOT EXISTS food_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    food_name VARCHAR(150) NOT NULL,
    meal_type VARCHAR(25) NOT NULL DEFAULT 'Unspecified',
    portion_grams DECIMAL(8,2) NOT NULL,
    calories DECIMAL(10,2) NOT NULL,
    entry_date DATE NOT NULL,
    image_path VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_food_user_date (user_id, entry_date),
    CONSTRAINT fk_food_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS activity_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    activity_name VARCHAR(120) NOT NULL,
    duration_minutes INT NOT NULL,
    calories_burned DECIMAL(8,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_user (user_id),
    CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS weight_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    weight_kg DECIMAL(5,2) NOT NULL,
    note VARCHAR(150) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_weight_user (user_id),
    CONSTRAINT fk_weight_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS password_reset_sessions (
    session_id CHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    used TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reset_session_email (email)
);
