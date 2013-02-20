/**
* Express config
*/

var express = require('express'),
	app = module.exports = express(),
	http = require('http'),
	server = http.createServer(app),
	fs = require('fs');

app.configure(function() {
	app.use(express.bodyParser());
	app.use(express.static(__dirname + '/public'));
	app.use(express.logger(':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms'));	
});

app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
    app.use(express.errorHandler()); 
});

/**
* Configure self
*/
var config = function() {
	var json, config = {};

	try {
		json = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
	}
	catch(e) {
		console.log("** Error while reading config.json: " + e);
	}

	if(typeof(json.twitter) !== undefined) {
		config.twitter = { 
			consumer_key		: json.twitter.consumer_key,
			consumer_secret		: json.twitter.consumer_secret,
			access_token_key	: json.twitter.access_token_key,
			access_token_secret	: json.twitter.access_token_secret,
			track				: json.twitter.track
		}
	};

	if(typeof(json.schedule) !== undefined) {
		config.schedule = {
			host	: json.schedule.host,
			port	: json.schedule.port,
			path	: json.schedule.path,
			time_slots: json.schedule.time_slots
		}
	}

	if(typeof(json.admin) !== undefined) {
		config.admin = {
			user : json.admin.user,
			pass : json.admin.pass
		}
	}

	return config;
}();

/**
* Utils
*/
var adminAuth = express.basicAuth( function(user, password) {
	return ( user == config.admin.user && password == config.admin.pass) ? true : false;
});

function strencode( data ) {
  return unescape( encodeURIComponent( JSON.stringify( data ) ) );
}

/**
* Routing
*
* /schedule
* /wall
* /admin
* /push
* GET /update
* POST /update
* /
*/

app.get('/schedule', function(req, res) {
	res.sendfile(__dirname + '/public/schedule.html');
});

app.get('/wall', function(req, res) {
	res.sendfile(__dirname + '/public/wall.html');
});

app.get('/admin', adminAuth, function(req, res) {
	res.sendfile(__dirname + '/public/admin.html');
});

app.get('/push', adminAuth, function(req, res) {
});

app.get('/update', adminAuth, function(req, res) {
	res.sendfile(__dirname + '/public/update.html');
});

app.post('/update', adminAuth, function(req, res) {
});

app.get('/', function(req, res) {
	res.sendfile(__dirname + '/public/wall.html');
})

server.listen(8080);
console.log(' | Server listening');

/**
* Twitter functions
*
* set up connection
* push to client
* handle disconnects from twitter
*/

var twitter = require('ntwitter'), 
	twitter_stream = '';

var t = new twitter({
	consumer_key: config.twitter.consumer_key,
	consumer_secret: config.twitter.consumer_secret,
	access_token_key: config.twitter.access_token_key,
	access_token_secret: config.twitter.access_token_secret
});

function connectStream(){

	t.stream('statuses/filter', {track: config.twitter.track}, function(stream) {

		twitter_stream = stream;

		console.log(' | Stream start');

		stream.on('data', function(data){
			json = strencode(data);

			if(json.length > 0) {
				try {
					updates.emit('tweet', json);
				}
				catch(e) {
					console.log("** Error sending Tweet: " + e);
					console.log("** Tweet: " + json);
				}
			}
		});

		stream.on('end', function(data) {
			twitter_stream = '';
			console.log(' | Stream end');
			connectStream();
		});

		stream.on('error', function(error) {
			twitter_stream = '';
			console.log('** Error in Twitter Stream: ' + error);
			connectStream();
		});
	});
	
}

/**
* Schedule functions
*
* update schedule json
* push updated schedule to client
* update currently running session
*/

/**
* Updates functions
*
* handle post of an update
*/

var moment = require('moment');

function setCurrentSession() {
	var now = moment();

	var current_slot_index = 0;
	while(now.isAfter(config.schedule.time_slots[current_slot_index], 'minute')) {
		current_slot_index += 1;
		if(current_slot_index >= 12) {
			break;
		}
	}

	var schJSON = JSON.parse(fs.readFileSync(__dirname +'/web.json', 'utf8'));

	var output = {};

	// we haven't yet started the day
	if(current_slot_index == 0) {
		output.type = 'special';
		output.string = "Barcamp Bangalore 13 begins at 08:00 AM on 2nd March 2013, hope to see you there!";
	}
	else if (current_slot_index == 12) { // the day has ended
		output.type = 'special';
		output.string = "Barcamp Bangalore 13 is over. Thanks for coming by.";
	}
	else { // we are in some session
		output.type = schJSON.slots[current_slot_index-1].type;
		output.tracks = schJSON.tracks;
		output.slot = schJSON.slots[current_slot_index-1];
	}

	updates.emit( "current_session", { ata: output } );
}

/**
* Websockets
*
* set up updates+twitter socket, populate initial updates
* set up schedule socket, populate initial schedule
*/
var	io = require('socket.io').listen(server),
 	totWallUsers = 0,
 	totScheduleUsers = 0;
	
io.configure(function() { 
	io.enable('browser client minification');
	io.set('log level', 1); 
	io.set('transports', [ 
			'websocket',
		//	'flashsocket',
			'htmlfile',
			'xhr-polling',
			'jsonp-polling'
	]);
}); 

var updates = io.of('/updates').on('connection', function(client) {
	totWallUsers++;
	console.log(' | User '+ client.id +' connected, total wall users: ' + totWallUsers)

	if ((totWallUsers > 0) && (twitter_stream == '')) {
		connectStream();
	}

	setCurrentSession();
	try {
		var updJSON = JSON.parse(fs.readFileSync(__dirname +'/updates.json', 'utf8'));
		client.json.emit('init_updates', { ata : updJSON } );
	}
	catch(e) {
		console.log("** Error Initializing Updates: " + e);
	}

	client.on('disconnect', function() {
		totWallUsers--;
		console.log(' | User '+ client.id +' disconnected, total wall users: '+ totWallUsers);

		if (totWallUsers == 0) {
			console.log(' | 0 Users, disconnecting Twitter stream');
			twitter_stream.destroy();
			twitter_stream = '';
		}

	});
});

var currentSessionInterval = setInterval(setCurrentSession, 300000);