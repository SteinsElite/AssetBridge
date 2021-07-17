const { createLogger, format, transports } = require("winston");
const path = require("path");
require("winston-daily-rotate-file");

class ConsoleTransport extends transports.Console {
  constructor(options) {
    super(options);

    this.format = format.combine(
      format((info) => {
        info.level = info.level.toUpperCase();
        return info;
      })(),
      format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      format.colorize(),
      format.printf(options.formatter)
    );
  }
}

class FileTransport extends transports.DailyRotateFile {
  constructor(options) {
    super(options);

    this.datePattern = "YYYY-MM-DD";
    this.zippedArchive = true;
    this.maxSize = "100m";
    this.maxFiles = "14d";

    const defaultFormatter = format.combine(
      format((info) => {
        info.name = options.name;
        info.level = info.level.toUpperCase();
        return info;
      })(),
      format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" })
    );

    if (options.json) {
      this.format = format.combine(defaultFormatter, format.json(options.formatter));
    } else {
      this.format = format.combine(defaultFormatter, format.printf(options.formatter));
    }
  }
}

function getLogger(name) {
  let options = {
    name: name,
    filePath: "./log",
    formatter: (meta) => {
      return `${meta.timestamp} ${meta.level} [${meta.op}] ${meta.message}`;
    },
    json: false,
  };

  const consoleTransport = new ConsoleTransport({
    level: "info",
    name: options.name,
    formatter: options.formatter,
  });

  const infoTransport = new FileTransport({
    level: "info",
    name: options.name,
    filename: path.join(options.filePath, `info/${options.name}-info-%DATE%.log`),
    formatter: options.formatter,
    json: options.json,
  });

  const errorTransport = new FileTransport({
    level: "error",
    name: options.name,
    filename: path.join(options.filePath, "error/error-%DATE%.log"),
    formatter: options.formatter,
    json: options.json,
  });
  return createLogger({ transports: [consoleTransport, infoTransport, errorTransport] });
}

const loggerC = getLogger("bridgeC");
const loggerH = getLogger("bridgeH");

module.exports = { loggerC, loggerH };
