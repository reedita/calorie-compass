// Vercel entrypoint: expose the Express application as a serverless function.
const express = require("express");
const { app } = require("./server/server");

module.exports = app;
