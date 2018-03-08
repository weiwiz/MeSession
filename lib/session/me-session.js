/**
 * Created by jacky on 2017/2/4.
 */
'use strict';
var util = require('util');
var net = require('net');
var logger = require('./../mlogger/mlogger');
var VirtualDevice = require('./../virtual-device').VirtualDevice;
var OPERATION_SCHEMAS = {
  sendMessage: {
    "type": "object",
    "properties": {
      "sendTo": {"type": "string"},
      "data": {
        "type": [
          "object",
          "array",
          "number",
          "boolean",
          "string",
          "null"
        ]
      }
    },
    "required": ["sendTo", "data"]
  }
};

function aliveCheck(self) {
  var handlerName = self.configurator.getConf("self.extra.forward");
  for (var socket in self.sockets) {
    var message = {
      devices: self.configurator.getConfRandom("services." + handlerName),
      payload: {
        cmdName: "aliveCheck",
        cmdCode: "0003",
        parameters: {
          from: socket
        }
      }
    };
    self.message(message, function (response) {
      if (response.retCode !== 200) {
        logger.error(response.retCode, response.description);
      }
      else {
        if (!util.isNullOrUndefined(response.data) && response.data.alive === false) {
          logger.debug("socket:[" + response.data.socket + "] lose connection.");
          var socketObj = self.sockets[response.data.socket];
          if (!util.isNullOrUndefined(socketObj)) {
            socketObj.destroy();
            delete self.sockets[response.data.socket];
          }
        }
        else {
          logger.debug("socket:[" + response.data.socket + "] is alive");
        }
      }
    });
  }
}

function Session(conx, uuid, token, configurator) {
  this.sockets = {};
  this.dataBuff = {};
  VirtualDevice.call(this, conx, uuid, token, configurator);
}

util.inherits(Session, VirtualDevice);

Session.prototype.init = function () {
  var self = this;
  var listenPort = self.configurator.getConf("self.extra.listen_port");
  var handlerName = self.configurator.getConf("self.extra.forward");
  net.createServer(function (socket) {
    logger.debug("new connection:" + socket.remoteAddress + ":" + socket.remotePort);
    self.sockets[socket.remoteAddress + ":" + socket.remotePort] = socket;
    socket.on('data', function (data) {
      var from = socket.remoteAddress + ":" + socket.remotePort;
      var newDataBuff = new Buffer(data);
      if (util.isNullOrUndefined(self.dataBuff[from])) {
        self.dataBuff[from] = newDataBuff;
      }
      else {
        self.dataBuff[from] = Buffer.concat([self.dataBuff[from], newDataBuff]);
      }
      var start = 0;
      var end = 0;
      for (var len = self.dataBuff[from].length; end < len; ++end) {
        if (self.dataBuff[from][end] === 10) {
          var msgDataBuf = self.dataBuff[from].slice(start, end);
          start = end + 1;
          var message = {
            devices: self.configurator.getConfRandom("services." + handlerName),
            payload: {
              cmdName: "handle",
              cmdCode: "0001",
              parameters: {
                from: from,
                data: msgDataBuf
              }
            }
          };
          self.message(message, function (response) {
            if (response.retCode !== 200) {
              logger.error(response.retCode, response.description);
            }
            else {
              if (!util.isNullOrUndefined(response.data)) {
                socket.write(new Buffer(response.data));
              }
            }
          });
        }
      }
      if (start < end) {
        if (start > 0) {
          self.dataBuff[from] = self.dataBuff[from].slice(start, end);
        }
      }
      else {
        self.dataBuff[from] = undefined;
      }
    });
    socket.on('end', function () {
      logger.debug("connection closed:" + socket.remoteAddress + ":" + socket.remotePort);
      var message = {
        devices: self.configurator.getConfRandom("services." + handlerName),
        payload: {
          cmdName: "disconnected",
          cmdCode: "0002",
          parameters: {
            from: socket.remoteAddress + ":" + socket.remotePort
          }
        }
      };
      self.message(message);
      delete self.sockets[socket.remoteAddress + ":" + socket.remotePort];
    });
    socket.on('error', function () {
      logger.debug("connection reset by peer:" + socket.remoteAddress + ":" + socket.remotePort);
      var message = {
        devices: self.configurator.getConfRandom("services." + handlerName),
        payload: {
          cmdName: "disconnected",
          cmdCode: "0002",
          parameters: {
            from: socket.remoteAddress + ":" + socket.remotePort
          }
        }
      };
      self.message(message);
      delete self.sockets[socket.remoteAddress + ":" + socket.remotePort];
    });
  }).listen(listenPort);
  setInterval(aliveCheck, 30 * 1000, self);
  logger.debug("MeSession listen on:" + listenPort);
};

/**
 * 远程RPC回调函数
 * @callback onMessage~sendMessage
 * @param {object} response:
 * {
 *      "payload":
 *      {
 *          "code":{number},
 *          "message":{string},
 *          "data":{object}
 *      }
 * }
 */
/**
 * 发送短信
 * @param {object} message :消息体
 * @param {onMessage~sendMessage} peerCallback: 远程RPC回调函数
 * */
Session.prototype.sendMessage = function (message, peerCallback) {
  var self = this;
  var responseMessage = {retCode: 200, description: "Success.", data: {}};
  self.messageValidate(message, OPERATION_SCHEMAS.sendMessage, function (error) {
    if (error) {
      responseMessage = error;
      peerCallback(error);
    }
    else {
      var socket = self.sockets[message.sendTo];
      if (!util.isNullOrUndefined(socket)) {
        socket.write(message.data);
      }
      else {
        responseMessage.retCode = 216001;
        responseMessage.description = "Can not find session by:" + message.sendTo;
      }
      peerCallback(responseMessage);
    }
  });
};


module.exports = {
  Service: Session,
  OperationSchemas: OPERATION_SCHEMAS
};
