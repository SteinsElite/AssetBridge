const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label,prettyPrint, splat, simple} = format;

const winston = require("winston");

const loggerC = winston.createLogger({
    format: combine(timestamp({format: 'YYYY-MM-DD HH:mm:ss'}), prettyPrint()),
    transports: [
        new winston.transports.Console({
            format: simple()
        }),
        new winston.transports.File({
            filename: "operationC.log",
            level: "info",
            maxFiles:100,
            maxsize: 1024*1024*4,
        }),
        new winston.transports.File({
            filename: "errorC.log",
            level: "error",
            maxsize: 1024*1024*4,
        }),
    ],
});

const loggerH = winston.createLogger({
    format: combine(timestamp({format: 'YYYY-MM-DD HH:mm:ss'}), prettyPrint()), 
    transports: [
        new winston.transports.Console({
            format: simple()
        }),
        new winston.transports.File({
            filename: "operationH.log",
            level: "info",
            maxFiles: 100,
            maxsize: 1024*1024,
        }),
        new winston.transports.File({
            filename: "errorH.log",
            level: "error",
            maxsize: 1024*1024,
        }),
    ],
});

module.exports = {loggerC, loggerH};