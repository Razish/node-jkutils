#!/usr/bin/env node

'use strict';

// Utilities and helpers for communication with Jedi Academy and Jedi Outcast servers/clients

// core packages
const dgram = require( 'dgram' );
const EventEmitter = require( 'events' );

// exported object
let jkutils = {};

// protocol support based on:
//	dpmaster, doc/techinfo.txt
//	id software ftp, idstuff/quake3/docs/server.txt

jkutils.protocolStrings = {
	'DarkPlaces': 'DP',
	'QuakeArena-1': 'Q3A',
	'Wolfenstein-1': 'RtCW',
	'EnemyTerritory-1': 'WoET',
};

jkutils.protocolNumbers = {
	'15': 'Jedi Outcast 1.02',
	'16': 'Jedi Outcast 1.04',
	'26': 'Jedi Academy 1.01',
};

//TODO: swap '%' for '.' in net traffic
jkutils.badCharacters = [
	'\\',
	'/',
	';',
	'"',
	'%'
];

jkutils.oobPrefix = Buffer.from( [0xFF, 0xFF, 0xFF, 0xFF] );

// parse out an infostring
//	Object return
//	String info
//		"k1\v1\k2\v2"
//		"\k1\v1\k2\v2"
jkutils.parseInfostring = function( info ) {
	if ( info[0] === '\\' ) {
		info = info.slice( 1 );
	}

	let toks = info.split( '\\' );

	// this accounts for invalid key/value pairs
	let pairs = {};
	for ( let i = 0; i < toks.length - 1; i += 2 ) {
		pairs[toks[i]] = toks[i + 1];
	}
	return pairs;
}

// returns a Buffer of ip+port bytes
jkutils.encodeServer = function( ip, port ) {
	let buffer = Buffer.alloc( 6, 0, 'binary' );
	let octets = ip.split( '.' );
	buffer[0] = octets[0];
	buffer[1] = octets[1];
	buffer[2] = octets[2];
	buffer[3] = octets[3];
	buffer[4] = port >> 8;
	buffer[5] = port & 0xFF;
	return buffer;
}

// returns a { [] ip, Number port } from a Buffer
jkutils.decodeServer = function( buffer ) {
	let octets = buffer.slice( 0, 4 ).join( '.' );
	let portBuf = buffer.slice( 4, 6 );
	let port = portBuf[1];
	port |= portBuf[0] << 8;
	return {
		ip: octets,
		port: port,
	}
}

// strip Q3 colour codes from a string
jkutils.stripColours = function( s ) {
	return s.replace( /\^[0-9]/g, '' );
}

// returns a JKSocket(EventEmitter) with send capabilities
//	Function callback
//		Error err
//		Object socket
//			EventEmitter (.on)
//				infoResponse
//					callback: Object info, String ip, Number port
//				statusResponse
//					callback: Object info, Array clients, String ip, Number port
//			Object sendMasterCommand
//				Function getservers( options )
//					options:
//						String ip
//						[Number port] (default: ephemeral port https://en.wikipedia.org/wiki/Ephemeral_port)
//			Object sendServerCommand
//				Function getinfo( options )
//					options:
//						String ip
//						[Number port] (default: ephemeral port https://en.wikipedia.org/wiki/Ephemeral_port)
//						[String challenge] (default: 'jkutils-cli')
//				Function getstatus( options )
//					options:
//						String ip
//						[Number port] (default: ephemeral port https://en.wikipedia.org/wiki/Ephemeral_port)
//						[String challenge] (default: 'jkutils-cli')
jkutils.createSocket = function( callback ) {
	let server = dgram.createSocket( 'udp4' );

	class MyEmitter extends EventEmitter {};
	const socket = new MyEmitter();
	socket.sendMasterCommand = {
		"getservers": ( options ) => {
			if ( !options.ip ) {
				callback( 'IP must be specified' );
				return;
			}
			let port = options.port || 0;
			let protocol = options.protocol || '26';
			let response = Buffer.from( 'getservers ' + protocol );
			server.send(
				[jkutils.oobPrefix, response], port, options.ip,
				( err ) => {
					if ( err ) {
						callback( err );
						server.close();
						server = null;
					}
				}
			);
		},
	};
	socket.sendServerCommand = {
		"getinfo": ( options ) => {
			if ( !options.ip ) {
				callback( 'IP must be specified' );
				return;
			}
			let port = options.port || 0;
			let challenge = options.challenge || 'jkutils-query';
			let response = Buffer.from( 'getinfo ' + challenge );
			server.send(
				[jkutils.oobPrefix, response], port, options.ip,
				( err ) => {
					if ( err ) {
						callback( err );
						server.close();
						server = null;
					}
				}
			);
		},
		"getstatus": ( options ) => {
			if ( !options.ip ) {
				return callback( 'IP must be specified' );
			}
			let port = options.port || 0;
			let challenge = options.challenge || 'jkutils-query';
			let response = Buffer.from( 'getstatus ' + challenge );
			server.send(
				[jkutils.oobPrefix, response], port, options.ip,
				( err ) => {
					if ( err ) {
						callback( err );
						server.close();
						server = null;
					}
				}
			);
		}
	};
	socket.gameServers = {};

	socket.close = function() {
		if ( server ) {
			if ( server.close ) {
				server.close();
			}
			server = null;
		}
	};

	server.on(
		'close',
		() => {
			//server.close();
		}
	);
	server.on(
		'error',
		( err ) => {
			server.close();
			callback( err, null );
		}
	);

	server.on(
		'listening',
		() => {
			let address = server.address();
			console.log( `listening on ${address.address}:${address.port} (UDP)` );
			//FIXME: should we callback from here instead?
		}
	);

	server.on(
		'message',
		( msg, rinfo ) => {
			let source = {
				ip: rinfo.address,
				port: rinfo.port
			};

			let offset = 0;

			// read marker, should be [FF, FF, FF, FF]
			let marker = msg.readUInt32LE( offset );
			offset += 4;
			if ( marker !== 0xFFFFFFFF ) {
				console.log( 'missing start marker from ' + source.ip + ':' + source.port + ', received ' + marker );
				return;
			}

			let handlers = {
				'getserversResponse': ( source, msg, offset, stringArgs ) => {
					// dpmaster starts with: [ '\\' ]
					// masterjk3.ravensoft.com starts with: [ '\n', '\0' ]
					//
					// the last transmission ends with: [ '\\', 'E', 'O', 'T' ]
					// previous transmissions end with	: [ '\\', 'E', 'O', 'F' ]
					// dpmaster also appends this to each: [ '\0', '\0', '\0' ]
					//	masterjk3.ravensoft.com does not
					//
					// the first character after the message is always skipped, so masterjk3.ravensoft.com has to be
					//	helped along the way; we will skip to the first non-null byte!
					while ( msg.readUInt8( offset ) === 0 ) {
						offset++;
					}
					let serversBufIndex = null;
					while ( true ) {
						let from = msg.slice( offset + serversBufIndex );
						let newIndex = from.indexOf( '\\' );
						if ( newIndex === -1 ) {
							break;
						}
						serversBufIndex += newIndex + 1;

						let addrBuf = msg.slice( offset, offset + 6 );
						offset += 6;
						offset += 1; // skip the '\\''
						let addrObj = jkutils.decodeServer( addrBuf );
						//FIXME: maybe just emit event once with a full list of servers?
						//	override the timeout if possible?
						// that will benefit EOT vs EOF - we can kill the socket immediately on EOT
						socket.emit( 'getserversResponse', addrObj );
					};
				},
				'infoResponse': ( source, msg, offset, stringArgs ) => {
					let infoString = msg.slice( offset ).toString( 'ascii' );
					let info = jkutils.parseInfostring( infoString );

					let gameServer = socket.gameServers[source.ip + ':' + source.port];
					if ( gameServer ) {
						if ( info.challenge !== gameServer.challenge ) {
							callback(
								'rejecting server infoResponse (' + info.challenge + ' !== ' + gameServer.challenge + ')'
							);
							return offset;
						}
						delete info.challenge;
						gameServer.infoResponse = info;
					}
					socket.emit( 'infoResponse', info, source.ip, source.port );
				},
				'statusResponse': ( source, msg, offset, stringArgs ) => {
					let cleanMsg = msg.slice( offset ).toString( 'ascii' );
					let lines = cleanMsg.split( '\n' );
					let status = jkutils.parseInfostring( lines[0] );
					let gameServer = socket.gameServers[source.ip + ':' + source.port];
					if ( gameServer ) {
						if ( status.challenge !== gameServer.challenge ) {
							callback(
								'rejecting server statusResponse (' + info.challenge + ' !== ' + gameServer.challenge + ')'
							);
							return offset;
						}
					}
					// format: Score Ping "Name"
					let clients = lines.slice( 1, -1 );
					socket.emit( 'statusResponse', status, clients, source.ip, source.port );
				},
			};

			// the rest of the buffer should just be a string, typically space-delimited
			//	so pass it on to the command handler
			let stringArgs = msg.toString( 'ascii', offset ) // to ASCII
				.split( /[ \n\r\0\\]/ ); // split on delimiters/special chars
			let command = stringArgs[0];
			let handler = handlers[command]
			if ( !handler ) {
				console.log( 'unknown command: ' + command );
				console.log( 'data: ' + JSON.stringify( msg.slice( offset ) ) );

				return;
			}
			stringArgs = stringArgs.slice( 1 );

			offset += command.length + 1; // + 1 for space at end
			offset = handler( source, msg, offset, stringArgs );
		}
	);

	// listen for incoming datagrams on all interfaces
	server.bind( '0.0.0.0' );

	callback( null, socket );
}

let handlers = {
	'getservers': ( args ) => {
		if ( args.length < 2 ) {
			return console.log( 'usage: getservers <ip[:port]> [protocol]' );
		}
		let addr = args[1].split( ':' );
		let ip = addr[0];
		let port = (addr.length === 2) ? addr[1] : '29060';
		let protocol = (args.length === 3) ? args[2] : '26';

		console.log( 'getting servers from ' + ip + ':' + port );

		// chains getservers -> getserversResponse
		jkutils.createSocket(
			( err, socket ) => {
				//FIXME: move the socket timeout into jkutils.createSocket with callback?
				function noResponse() {
					console.log( 'timeout from ' + ip + ':' + port );
				}
				function getServersTimeout() {
					if ( !socket ) {
						// this has already been done, the timeout is useless
						return;
					}
					noResponse();
					socket.close();
					socket = null;
				}
				if ( err ) {
					return console.log( err );
				}

				let timeoutResponse = {};
				timeoutResponse[ip+':'+port] = {};
				if ( !socket ) {
					noResponse();
					return;
				}
				else {
					timeoutResponse[ip+':'+port]['getservers'] = setTimeout( getServersTimeout, 1000 );
				}

				console.log( 'getservers to ' + ip + ':' + port );
				socket.sendMasterCommand.getservers(
					{
						ip: ip,
						port: port,
						protocol: protocol,
					},
					( err ) => {
						if ( err ) {
							console.log( 'error: ' + err );
						}
					}
				);

				socket.on(
					'getserversResponse',
					( server ) => {
						if ( timeoutResponse[ip+':'+port]['getservers'] ) {
							clearTimeout( timeoutResponse[ip+':'+port]['getservers'] );
							timeoutResponse[ip+':'+port]['getservers'] = null;
						}

						console.log( ip + ':' + port + ' told us there is a server at ' + server.ip + ':' + server.port );

						//TODO: check for EOT and wait for more?

						// keep the socket alive again
						timeoutResponse[ip+':'+port]['getservers'] = setTimeout( getServersTimeout, 2500 );
					}
				);
			}
		);
	},

	'serverstatus': ( args ) => {
		if ( args.length !== 2 ) {
			return console.log( 'usage: serverstatus <ip[:port]>' );
		}
		let addr = args[1].split( ':' );
		let ip = addr[0];
		let port = (addr.length === 2) ? addr[1] : '29070';

		console.log( 'getting serverstatus for ' + ip + ':' + port );

		// chains getinfo -> infoResponse -> getstatus -> statusResponse
		//	this little dance is necessary to inform some strict firewalls that "we're really real ^_^"
		//	...like port knocking!
		jkutils.createSocket(
			( err, socket ) => {
				//FIXME: move the socket timeout into jkutils.createSocket with callback?
				function noResponse() {
					console.log( 'no response from ' + ip + ':' + port );
				}
				if ( err ) {
					return console.log( err );
				}

				let timeoutResponse = {};
				timeoutResponse[ip+':'+port] = {};
				if ( !socket ) {
					noResponse();
					return;
				}
				else {
					timeoutResponse[ip+':'+port]['getinfo'] = setTimeout(
						() => {
							if ( !socket ) {
								// this has already been done, the timeout is useless
								return;
							}
							console.log( 'timeout for socket on getinfo' );
							noResponse();
							socket.close();
							socket = null;
						},
						1000
					);
				}

				console.log( 'getinfo to ' + ip + ':' + port );
				socket.sendServerCommand.getinfo(
					{
						ip: ip,
						port: port,
						challenge: 'jkutils-cli',
					},
					( err ) => {
						if ( err ) {
							console.log( 'error: ' + err );
						}
					}
				);

				socket.on(
					'infoResponse',
					( info, ip, port ) => {
						if ( timeoutResponse[ip+':'+port]['getinfo'] ) {
							clearTimeout( timeoutResponse[ip+':'+port]['getinfo'] );
							timeoutResponse[ip+':'+port]['getinfo'] = null;
						}

						//console.log( 'info: ' + JSON.stringify( info, null, 4 ) );

						console.log( 'getstatus to ' + ip + ':' + port );
						timeoutResponse[ip+':'+port]['getstatus'] = setTimeout(
							() => {
								if ( !socket ) {
									// this has already been done, the timeout is useless
									return;
								}
								console.log( 'timeout for socket on getstatus' );
								noResponse();
								socket.close();
								socket = null;
							},
							1000
						);
						socket.sendServerCommand.getstatus(
							{
								ip: ip,
								port: port,
								challenge: 'jkutils-cli',
							},
							( err ) => {
								if ( err ) {
									console.log( 'error: ' + err );
								}
							}
						);

						socket.on(
							'statusResponse',
							( status, clients, ip, port ) => {
								if ( timeoutResponse[ip+':'+port]['getstatus'] ) {
									clearTimeout( timeoutResponse[ip+':'+port]['getstatus'] );
									timeoutResponse[ip+':'+port]['getstatus'] = null;
								}
								console.log( 'clients: ' + JSON.stringify( clients, null, 4 ) );
								console.log( 'status: ' + JSON.stringify( status, null, 4 ) );

								// we're done, close the socket
								socket.close();
								socket = null;
							}
						);
					}
				);
			}
		);
	},
};

if ( !module.parent ) {
	console.log( 'running jkutils from cli' );

	// cut off the process and script name
	let args = process.argv.slice( 2 );

	let handlerFunc = handlers[args[0]];
	if ( handlerFunc ) {
		return handlerFunc( args );
	}

	console.log( 'please specify a command:\n  ' + Object.keys( handlers ).join( '\n  ' ) );
}

module.exports = jkutils;
