#!/usr/bin/env node
// @ts-check

'use strict';

/**
 * wrapper around low-level socket usage (bind, send, error)
 * 		so the idea is you create a socket, set up your callback, issue command.
 * 		socket is "oneshot": callback will be reached upon socket error or socket result
 * 1) create socket with initCallback (error on bind, etc)
 * 2) send message to server  with callback (success, error)
 * 		2a) sending a message registers an on('message') listener, which fires sendCallback with null err
 * 		2b) any error during sending will fire the sendCallback with non-null err
 */

// core modules
const dgram =		require( 'dgram' );

// third party modules
const buffer_hexdump =	require( 'buffer-hexdump' );
const debug =			require( 'debug' )( 'socket' );

// internal modules
const JKUtils =		require( './jkutils' );

/**
 * JKSocket options (controls timeout/listener behaviour)
 * @typedef {Object} JKSocketOpts
 * @property {boolean} killOnFirstRes default: false (will remove event listeners after receiving first reply)
 * @property {boolean} retainSocket default: false (cannot re-use comms object again)
 */

module.exports = class JKSocket {

	/**
	 * @constructor
	 * @param {function} callback upon error
	 */
	constructor( callback ) {
		if ( !callback ) {
			throw new TypeError( 'callback must be specified' );
		}

		// use timeouts per {dst,msg} combination
		this.timers = {};

		this.socket = dgram.createSocket( 'udp4' );

		this.socket.on( 'close', function() {
			debug( 'socket closed' );
		} );

		this.socket.on( 'error', function( err ) {
			debug( `JKSocket::error err: ${JSON.stringify( err )}` );
			this.destroy();
			callback( err );
		} );

		this.socket.on( 'listening', function() {
			const address = this.address();
			debug( `listening on ${address.address}:${address.port} (UDP)` );

			callback( null );
		} );
	}

	/**
	 * clean up socket
	 * @param {boolean} [clearAllTimers] whether to remove all timers associated with this socket (e.g. final cleanup after reusing socket)
	 */
	destroy( clearAllTimers=false ) {
		if ( this.socket ) {
			debug( 'destroying socket' );
			this.socket.close();
			this.socket = null;
		}
		else {
			debug( 'destroy(): no socket to cleanup' );
		}
		if ( clearAllTimers ) {
			for ( let timerKey in this.timers ) {
				const timer = this.timers[timerKey];
				this.clearTimer( timerKey, 'clearing all timers' );
				if ( timer !== undefined ) {
					debug( `destroy(): clearing timer "${timerKey}" with ID ${JSON.stringify(timer)}` );
				}
			}
		}
	}

	/**
	 * ???
	 * @param {string} key socket timeout ID to clear
	 * @param {string} [reason] debug marker
	 */
	clearTimer( key, reason ) {
		if ( key === undefined ) {
			throw new TypeError( 'key must be specified' );
		}
		if ( this.timers[key] !== undefined ) {
			debug( `clearing timer "${key}" (reason: ${reason})` );
			clearTimeout( this.timers[key] );
			this.timers[key] = undefined;
		}
	}

	/**
	 * send an arbitrary OOB message to a Q3 server
	 * @param {object} dest
	 * @param {string} dest.ip
	 * @param {number} dest.port
	 * @param {JKSocketOpts} opts socket behaviour
	 * @param {Buffer} msg NOTE: do NOT prefix with Q3 OOB identifier
	 * @param {function} callback upon success or error.  NOTE: socket will be destroyed upon error
	 */
	send( dest, opts, msg, callback ) {
		if ( !callback ) {
			this.destroy();
			throw new TypeError( 'callback must be specified' );
		}

		// set up timeouts
		const msgKey = `^${dest.ip}~${dest.port}~${msg.toString().split( ' ' )[0]}$`;
		this.clearTimer( msgKey, 'msg send' );
		this.timers[msgKey] = setTimeout( (jkSocket, callback, msgKey) => {
			if ( jkSocket && jkSocket.socket ) {
				debug( `timeout on socket "${msgKey}"` );
				jkSocket.socket.close();
				jkSocket.socket = null;
				callback( 'socket timeout' );
			}
			else {
				//FIXME: process is not ending because the socket is hanging? timeout?
				console.log( `timeout on missing socket "${msgKey}" - forgot to clear timer after closing socket? socket: "${jkSocket.socket}"` );
			}
		}, 2500, this, callback, msgKey );

		// prepare to handle response
		this.recvMsg = (msg, rinfo) => {
			debug( `received msg from ${rinfo.address}:${rinfo.port}:\n${buffer_hexdump( msg )}` );
			const data = {
				source: {
					ip: rinfo.address,
					port: rinfo.port,
				},
				response: msg,
			};

			if ( opts.killOnFirstRes ) {
				this.clearTimer( msgKey, 'killed on first response' );
				this.socket.removeListener( 'message', this.recvMsg );
			}

			// we may be done with the socket, destroy
			if ( !opts.retainSocket ) {
				this.clearTimer( msgKey, 'socket not retained' );
				this.destroy();
			}

			callback( null, data );
		};
		this.socket.on( 'message', this.recvMsg );

		// now send the message
		debug( `sending msg to ${dest.ip}:${dest.port}:\n${buffer_hexdump( msg )}` );
		this.socket.send( [JKUtils.oobPrefix, msg], dest.port, dest.ip, (err, bytes) => {
			if ( err ) {
				debug( `JKSocket::send::send err: ${JSON.stringify( err )}` );
				//FIXME: `this` is undefined, reproduce by disabling networking
				//this.socket.destroy();
				callback( err, bytes );
				//this.clearTimer( msgKey );
			}
			// successful send: NOP
		} );
	}

};
