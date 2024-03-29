import net from 'net';
import tls from 'tls';
import url from 'url';
import EventEmitter from 'events';

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

class response {
  constructor(method) {
    this.body = null;
    this.data = [];
    this.done = false;
    this.headerDone = false;
    this.statusCode = 200;
    this.headers = {};
    if (method) this.method = method;
  }

  write(chunk) {
    if (this.done) throw new Error("Response already finished");

    if (!this.headerDone) {
      if (this.parseHeader(chunk)) {
        this.headerDone = true;

        if (this.method == "HEAD") {
          this.done = true;
        } else {
          checkLength(this.data[0].length, this);
        }
      }
    } else {
      this.data.push(chunk);
      let totalLength = 0;

      for (let i = 0; i < this.data.length; i++) {
        totalLength += this.data[i].length;
      }

      checkLength(totalLength, this);
    }

    function checkLength(length, t) {
      if (length >= t.headers['Content-Length']) {
        t.body = Buffer.concat(t.data);
        t.data = [];
        t.done = true;
      }

      return t.done;
    }

    return this.done;
  }

  parseHeader(data) {
    let header = data.toString('ascii');
    let lines = header.split("\r\n");
    let flag = false;
    let status = lines[0].split(" ");
    this.statusCode = Number(status[1]);

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i] || lines[i] == "\r\n") {
        const temp = Buffer.from(lines.slice(0, i).join("\r\n") + "\r\n", 'ascii').length;
        if (this.headers['Content-Length']) this.data.push(data.slice(temp + 2, temp + this.headers['Content-Length']));else this.data.push(data.slice(temp));
        break;
      }

      let line = lines[i].split(":");
      this.headers[line[0].trim()] = isNaN(parseInt(line[1].trim())) ? line[1].trim() : parseInt(line[1].trim());
      if (i == lines.length) flag = true;
    }

    return !flag;
  }

  getRaw() {
    if (this.body && this.done) {
      return this.body;
    } else if (this.method == "HEAD") {
      throw new Error("This function is not supported in HEAD method");
    } else {
      throw new Error("Response not finished");
    }
  }

  getText(encoding = 'ascii') {
    return this.getRaw().toString(encoding);
  }

}

class HTTPConnection extends EventEmitter {
  constructor(Target, options) {
    super();
    this.connected = false;
    this.headers = {};
    this.timeout = 5000;
    this.urlObj = new url.URL(Target);
    this.port = Number(this.urlObj.port) || this.urlObj.protocol === "https:" ? 443 : 80;
    if (!this.urlObj.hostname) throw new Error("Invalid URL");
    this.host = this.urlObj.hostname;
    this.socket = new net.Socket();
    this.setHeader("Host", this.urlObj.hostname);
    this.socket.on("error", error => {
      throw error;
    });
    this.socket.on("close", () => this.connected = false);

    if (options) {
      this.timeout = options.timeout || this.timeout;
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        if (this.connected) resolve(true);

        if (this.urlObj.protocol === "https:") {
          const tlsContext = tls.createSecureContext({
            maxVersion: 'TLSv1.3',
            minVersion: 'TLSv1.2'
          });
          this.socket = tls.connect(this.port, this.host, {
            rejectUnauthorized: false,
            servername: this.host,
            secureContext: tlsContext
          }, () => {});
        } else {
          this.socket.connect(this.port, this.host);
        }

        this.socket.once('connect', () => {
          this.connected = true;
          resolve(true);
        });
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      try {
        if (this.connected) resolve(true);
        this.socket.connect(this.port, this.host);
        this.socket.once('close', () => {
          this.connected = false;
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  formatRequest(method, url, headers, body) {
    let request = `${method} ${url} HTTP/1.1\r\n`;

    for (let key in headers) {
      request += `${key}: ${headers[key]}\r\n`;
    }

    request += "\r\n";

    if (body) {
      request += body;
    }

    return request;
  }

  setHeader(key, value) {
    this.headers[key] = value;
  }

  removeHeader(key) {
    delete this.headers[key];
  }

  send(data) {
    if (!this.connected) throw new Error("Not connected");

    try {
      this.socket.write(data);
    } catch (error) {
      throw error;
    }
  }

  recive(method) {
    return new Promise((resolve, reject) => {
      let res = new response(method);
      this.socket.on('data', data => {
        this.emit('data', data);

        if (res.write(data)) {
          this.socket.removeAllListeners('data');
          resolve(res);
        }
      });
      setTimeout(() => {
        if (!res.headers['Content-Length']) resolve(res);
      }, this.timeout);
    });
  }

}

class HTTPClient extends HTTPConnection {
  constructor(Target, options) {
    super(Target, options);
  }

  get(url) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("GET", url, this.headers);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('GET');
      return response;
    });
  }

  post(url, body) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("POST", url, this.headers, body);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('POST');
      return response;
    });
  }

  put(url, body) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("PUT", url, this.headers, body);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('PUT');
      return response;
    });
  }

  delete(url, body) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("DELETE", url, this.headers, body);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('DELETE');
      return response;
    });
  }

  head(url) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("HEAD", url, this.headers);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('HEAD');
      return response;
    });
  }

  patch(url, body) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.connected) throw new Error("Must be connected to send request");
      let request = this.formatRequest("PATCH", url, this.headers, body);
      this.send(Buffer.from(request, 'ascii'));
      const response = yield this.recive('PATCH');
      return response;
    });
  }

}

export { HTTPClient, HTTPConnection, response };
