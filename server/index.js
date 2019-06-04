const parser = require('ua-parser-js');

class SnapdropServer {

    constructor(port) {
        const WebSocket = require('ws');
        this._wss = new WebSocket.Server({ port: port });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {
            "un": {}
        };

        console.log('Snapdrop is running on port', port);
    }

    _onConnection(peer) {
        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        this._keepAlive(peer);
    }

    _onHeaders(headers, response) {
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId);
    }

    _onMessage(sender, message) {
        message = JSON.parse(message);

        switch (message.type) {
            case 'switch-net':
                this._switchNet(sender, message);
                break;
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }

        // relay message to recipient
        const room = (sender.net === 'fun') ? 'un' : sender.ip;

        if (room && message.to && this._rooms[room]) {
            const recipientId = message.to; // TODO: sanitize
            const recipient = this._rooms[room][recipientId];
            delete message.to;
            // add sender id
            message.sender = sender.id;
            this._send(recipient, message);
            return;
        }
    }

/*    _toggleFun(peer, message) {
        if (!message || !message.toggle ) return;

        if (message.toggle === 'on') {
            this._joinFun(peer);
        } else if (message.toggle === 'off') {
            this._leaveFun(peer);
        }
    }

    _joinFun(peer) {
        // if room doesn't exist, create it
        if (!this._rooms['un']) {
            this._rooms['un'] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms['un']) {
            const otherPeer = this._rooms['un'][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms['un']) {
            otherPeers.push(this._rooms['un'][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms['un'][peer.id] = peer;
    }

    _leaveFun(peer) {
        if (!this._rooms['un'] || !this._rooms['un'][peer.id]) return;

        // delete the peer
        delete this._rooms['un'][peer.id];

        // notify all other peers
        for (const otherPeerId in this._rooms['un']) {
            const otherPeer = this._rooms['un'][otherPeerId];
            this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
        }
    }*/

    _switchNet(peer, message) {
        if (!message || !message.net ) return;

        peer.net = message.net;

        this._leaveRoom(peer);

        setTimeout(() => {
            this._joinRoom(peer);
            peer.socket.on('message', message => this._onMessage(peer, message));
            this._keepAlive(peer);
        }, 3000);
    }

    _joinRoom(peer) {
        const room = (peer.net === 'fun') ? 'un' : peer.ip;

        // if room doesn't exist, create it
        if (!this._rooms[room]) {
            this._rooms[room] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[room]) {
            const otherPeer = this._rooms[room][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[room]) {
            otherPeers.push(this._rooms[room][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers,
            net: peer.net
        });

        // add peer to room
        this._rooms[room][peer.id] = peer;

        if (peer.net) {
            this._send(peer, {
                type: 'net-switched',
                net: peer.net
            });
        }
    }

    _leaveRoom(peer) {
        const room = (peer.net !== 'fun') ? 'un' : peer.ip;

        if (!this._rooms[room] || !this._rooms[room][peer.id]) return;
        
        this._cancelKeepAlive(this._rooms[room][peer.id]);
        
        // delete the peer
        delete this._rooms[room][peer.id];

        // terminate peer socket if not switching network
        if (!peer.net) {
            peer.socket.terminate();
        }

        //if room is empty, delete the room
        if (!Object.keys(this._rooms[room]).length) {
            delete this._rooms[room];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[room]) {
                const otherPeer = this._rooms[room][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _send(peer, message) {
        if (!peer) return console.error('undefined peer');
        if (this._wss.readyState !== this._wss.OPEN) return console.error('Socket is closed');
        message = JSON.stringify(message);
        peer.socket.send(message, error => error ? console.log(error): '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 10000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}



class Peer {

    constructor(socket, request) {
        // set socket
        this.socket = socket;


        // set remote ip
        this._setIP(request);

        // set peer id
        this._setPeerId(request)
        // is WebRTC supported ?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        // set name 
        this._setName(request);
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setIP(request) {
        if (request.headers['x-forwarded-for']) {
            this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            this.ip = request.connection.remoteAddress;
        }
        // IPv4 and IPv6 use different values to refer to localhost
        if (this.ip == '::1' || this.ip == '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else {
            this.id = request.headers.cookie.replace('peerid=', '');
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        var ua = parser(req.headers['user-agent']);
        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
        let uuid = '',
            ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    };
}

const server = new SnapdropServer(process.env.PORT || 3000);