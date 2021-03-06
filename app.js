// Module Dependencies
// This file loosely based off of the tutorial at https://www.fenixapps.com/blog/express-nodejs-angularjs-and-socket-io/
// I've done this disgustingly because I'm lazy

var express = require('express'),
    bodyParser = require('body-parser'),
    http = require('http'),
    uuid = require('node-uuid'),
    sleep = require('sleep'),
    _ = require('lodash'),
    app = express(),
    session = require('express-session')({
      secret: 'Life, the universe, and everything',
      resave: true,
      saveUninitialized: true
    }),
    sharedsession = require('express-socket.io-session'),
    port = 8080,
    onlyShowAI = true, // Turn on if dev messages will only display AI messages
    dev  = true; // disable if you want the prod version

// Global logs. Logged on server and on the client
var broadcast = function(msg) {
  console.log(msg);
  io.emit("new message", msg);
};

// dev broadcasts. Developes only if dev mode is active
var _bc = function(msg, obj) {
  if (!dev)
    return;
  if (onlyShowAI) {
    if (msg.substring(0,4) === "[AI]" ||
        msg.substring(0,4) === "[DEA") {
          if (obj)
            console.log(msg, obj);
          else
              console.log(msg);
          io.emit("new message", msg);
        }
  }
  else {
    msg = "[DEV] ".concat(msg);
    if (obj)
      console.log(msg, obj);
    else
        console.log(msg);
    io.emit("new message", msg);
  }

};

// Define some needed model data
var game = {
  table: [],
  queuedPlayers: [],
  inProgress: false,
  deck: [],
  dealer: { pid: "dealer", hand: [], value: 0, isAI: true, playing: false, hasSplit: false, bust: false },
  currentPlayer: {},
  firstRound: true, // set to false every round
  currentPlayerIndex: 0,

  generateDeck: function() {
    var ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9","10", "J", "Q", "K"];
    var suits = ["♣", "♦", "♥", "♠"];
    var deck = [];

    // fill the deck
    for (var i = 0; i < suits.length; i++) {
      for (var j = 0; j < ranks.length; j++) {
        deck.push({rank: ranks[j], suit: suits[i], hidden: false});
      }
    }

    _bc("New Deck Generated");

    return game.shuffle(deck);
  },

  shuffle: function(deck) {
    _bc("Deck Shuffled");
    return _.shuffle(deck);
  },

  // deal two cards to each player at the table
  deal: function() {
    for (var i = 0; i < game.table.length; i++) {
      var card1 = game.deck.pop();
      card1.hidden = true;
      _bc("Player "+game.table[i].pid+" Dealt a hidden " + card1.rank + card1.suit);
      var card2 = game.deck.pop();
      card2.hidden = false;
      _bc("Player "+game.table[i].pid+" Dealt a visible " + card2.rank + card2.suit);
      game.table[i].hand.push(card1);
      game.table[i].hand.push(card2);
    }

    var c1 = game.deck.pop();
    c1.hidden = true;
    _bc("Dealer dealt a hidden " + c1.rank + c1.suit);
    var c2 = game.deck.pop();
    c2.hidden = false;
    _bc("Dealer dealt a visible " + c2.rank + c2.suit);
    game.dealer.hand.push(c1);
    game.dealer.hand.push(c2);
  },

  clearBoard: function() {
    _bc("Board cleared");
    for (var i = 0; i < game.table.length; i++) {
      if (game.table[i].isAI) {
        game.table.splice(i--,1);
      }
      else {
        game.table[i].hand = [];
        game.table[i].value = 0;
        game.table[i].playing = false;
        game.table[i].hasSplit = false;
        game.table[i].canHit = false;
        game.table[i].canStay = false;
        game.table[i].bust = false;
        game.table[i].winner = false;
      }
    }
    game.dealer = { pid: "dealer", hand: [], value: 0, isAI: true, playing: false, hasSplit: false, bust: false };
    game.currentPlayerIndex = 0;
    game.currentPlayer = game.table[0];
  },

  addFromQueue: function() {
    // If table isn't full, loop add people from the queue
    while (game.table.length < 3 && game.queuedPlayers.length !== 0) {
      var newPlayer = game.queuedPlayers.pop();
      game.table.push(newPlayer);
      _bc("Player Added from queue: " + newPlayer.pid);
      io.sockets.connected[newPlayer.sid].emit('begin', newPlayer);
    }
  },

  addAI: function() {
    // If there are spots left and the queue hasn't filled, add AI
    var remaining = 3 - game.table.length;
    for (var i = 0; i < remaining; i++) {
      var AI = { "pid": "AI-"+i, "hand": [], "value": 0, "isAI": true, "playing": false, "hasSplit": false, bust: false };
      game.table.push(AI);
      _bc("AI added to game");
    }
  },

  determineMoves: function(player) {
    game.calculateHand(player);

    player.canSplit = !!(game.firstRound && player.hand[0].rank === player.hand[1].rank);
    player.canHit = !!(player.playing && player.value < 21);
    player.canStay = !!(player.playing && player.value <= 21);

    _bc("Moves Determined. Player ["+player.pid+"] Can: "+(player.canSplit?"Split;":"")+(player.canHit?"Hit;":"")+(player.canStay?"Stay;":""));
  },

  // Emit the state of the table to the player, stripping data
  emitTable: function(player) {
    // They don't have a socket ID? Don't send, probably AI or error
    if (!('sid' in player))
      return;
    var newTable = _.cloneDeep(game.table);
    var playerIndex = -1;
    // For everyone, if it's not the current player, remove
    // their first card and delete their sid if it is there.
    for (var i = 0; i < newTable.length; i++) {
      if (newTable[i].pid != player.pid) {
        var other = newTable[i];
        other.hand[0] = "??";
        if ("sid" in other)
          delete other.sid;
        if (newTable[i].pid == game.currentPlayer.pid)
          newTable[i].active = true;
        else
          newTable[i].active = false;
        newTable[i].name = "Player " + i;
      }
      else
        playerIndex = i;

    }
    newTable.splice(playerIndex, 1);

    var cleanedDealer = _.cloneDeep(game.dealer);
    cleanedDealer.hand[0] = "??";
    if (game.currentPlayer.pid == game.dealer.pid) {
      cleanedDealer.active = true;
    }
    else {
      cleanedDealer.active = false;
    }

    game.determineMoves(player);
    player.name = "Player " + playerIndex;

    var data = {
      dealer: cleanedDealer,
      players: newTable,
      me: player,
      myTurn: game.currentPlayer === player
    };

    io.sockets.connected[player.sid].emit('turnPlayed', data);
  },

  broadcastTable: function() {
    for (var i = 0; i < game.table.length; i++) {
      game.emitTable(game.table[i]);
    }
  },

  onlyAI: function() {
    for (var i = 0; i < game.table.length; i++) {
      if (!game.table[i].isAI) {
        _bc("Checking if Only AI left... Player found.");
        return false;
      }
    }
    _bc("Only AI remaining, quitting game.");
    return true;
  },

  threePlayersDone: function() {
    var remainingPlayers = game.table.length+1;
    var bust = 0;
    if (!game.dealer.playing)
      remainingPlayers--;
    if (game.dealer.bust)
      bust++;
    for (var i = 0; i < game.table.length; i++) {
      if (!game.table[i].playing)
        remainingPlayers--;
      if (game.table[i].bust)
        bust++;
    }
    // If the dealer is done, then it must be true
    _bc("Determined: " + bust + " players are bust");
    _bc("Determined: " + remainingPlayers + " players are still playing");
    return remainingPlayers===0 || bust === game.table.length;
  },

  // Game is over when all players are not currently playing, inProgress is false (somebody won)
  // or there is only AI players
  isGameOver: function() {
    _bc("Game should end: " + !(game.inProgress) || game.threePlayersDone() || game.onlyAI());
    return !(game.inProgress) || game.threePlayersDone() || game.onlyAI();
  },

  calculateHand: function(player) {
    var value = 0;
    var numberOfAces = 0; // To simplify things later

    for (var i = 0; i < player.hand.length; i++) {
      var card = player.hand[i];
      if (card.rank === "K" || card.rank === "Q" || card.rank === "J")
        value += 10;
      else if (card.rank === "A") {
        value += 11;
        numberOfAces++;
      }
      else
        value += parseInt(card.rank);
    }

    // Now determine if they are bust. If so, drop the Ace down to a 1 if they
    // had one (subtract 10 from their value)
    while (numberOfAces > 0 && value > 21) {
      numberOfAces--;
      value-=10;
    }

    _bc("Player " + player.pid + " Has a hand of value " + value);

    player.value = value;
  },

  getVisibleHand: function(hand) {
    var visible = [];
    for (var i = 0; i < hand.length; i++) {
      if (!hand[i].hidden)
        visible.push(hand[i]);
    }
    return visible;
  },

  visibleHandValue: function(player) {
    var value = 0;
    var numberOfAces = 0; // To simplify things later
    var visibleHand = game.getVisibleHand(player.hand);

    for (var i = 0; i < visibleHand.length; i++) {
      var card = visibleHand[i];
      if (card.rank === "K" || card.rank === "Q" || card.rank === "J")
        value += 10;
      else if (card.rank === "A") {
        value += 11;
        numberOfAces++;
      }
      else
        value += parseInt(card.rank);
    }

    // Now determine if they are bust. If so, drop the Ace down to a 1 if they
    // had one (subtract 10 from their value)
    while (numberOfAces > 0 && value > 21) {
      numberOfAces--;
      value-=10;
    }

    _bc("Player " + player.pid + " has a visible hand value of " + value);

    return value;
  },

  calculateHands: function() {
    _bc("Calculating hands");
    for (var i = 0; i < game.table.length; i++) {
      game.calculateHand(game.table[i]);
    }
    game.calculateHand(game.dealer);
  },

  disconnectPlayer: function(player) {
    player.bust = true;
    player.playing = false;
    var i = 0;

    broadcast("[!] Player has disconnected.");

    for (i = 0; i < game.queuedPlayers.length; i++) {
      if (game.queuedPlayers[i] === player) {
        game.queuedPlayers.splice(i, 1);
        break;
      }
    }
    for (i = 0; i < game.table.length; i++) {
      if (game.table[i] === player) {
        game.table.splice(i, 1);
        break;
      }
    }

    if (player === game.currentPlayer)
      game.nextRound();

    game.broadcastTable();
  },

  containsAce: function(hand) {
    _bc("Checking if hand contains an ace");
    for (var i = 0; i < hand.length; i++) {
      if (hand[i] === "A") {
        _bc("Hand does contain an ace: ", hand);
        return true;
      }
    }

    _bc("Hand does not contain an ace: ", hand);
    return false;
  },

  aiShouldHit: function(player) {
    // If value is less than 18, hit
    game.calculateHands();

    if (player.value === 21) {
      _bc("[AI] has a hand of value 21. Do not hit.");
      return false;
    }
    if (player.value < 18) {
      _bc("[AI] has a hand of value less than 21. Hit.");
      return true;
    }

    var newTable = _.clone(game.table);
    newTable.push(game.dealer);

    // REQ-13; AI sees another player stayed with two cards and one is Ace or value 10, hit
    for (var i = 0; i < newTable.length; i++) {
      var other = newTable[i];
      if (other === player || other.bust)
        continue;
      if (!other.playing && other.hand.length === 2) {
        var visibleCard = (other.hand[0].hidden)? other.hand[1]:other.hand[0];
        if (visibleCard === "A" || visibleCard === "10" ||
            visibleCard === "J" || visibleCard === "Q" ||
            visibleCard === "K") {
              _bc("[AI] REQ-13: Another player has stayed with 2 cards. One is A, 10, J, Q, or K.");
              _bc("[AI] Other Hand: ", other.hand);
              _bc("[AI] My Hand: ", player.hand);
              _bc("[AI] Other Hand: ", other.hand);
              return true;
          }
      }
    }
    // Value between [18,20]. If anyone visibly has my hand - 10, hit
    for (var j = 0; j < newTable.length; j++) {
      var otherp = newTable[j];
      if (otherp !== player && game.visibleHandValue(otherp) > (player.value - 10)) {
        _bc("[AI] My hand value ("+player.value+") is between 18 and twenty and someone has a value greated than my hand minus ten. I must hit.");
        _bc("[AI] Other Visible Value: "+ game.visibleHandValue(otherp));
        _bc("[AI] My Hand: ", player.hand);
        _bc("[AI] Other Hand: ", otherp.hand);
        return true;
      }
    }

    _bc("[AI] No tests passed. Do not hit.");
    // If none of these pass, just stay.
    return false;
  },

  playAI: function(player) {
    _bc("[AI] ----------"+player.pid+"------------ [AI]");
    game.determineMoves(player);
    game.calculateHand(player);

    _bc("[AI] AI Playing");

    if (player.value === 21) {
      _bc("[AI] Hand value is 21. Stay");
      game.stay(player);
    }
    else if (player.value < 18) {
      _bc("[AI] Hand value ("+player.value+") is less than 18. Hit");
      game.hit(player);
    }
    else if (player.canSplit) {
      _bc("[AI] Player can split. Split");
      game.split(player);
    }
    else if (game.aiShouldHit(player))
      game.hit(player);
    else {
      _bc("[AI] No solutions found. Must have to stay.");
      game.stay(player);
    }
    _bc("[AI] ----------     END    ------------ [AI]");
  },

  playDealer: function() {
    _bc("[DEALER] ---------------------- [DEALER]");
    _bc("[DEALER] Dealer playing.");
    if (game.dealer.value < 17) {
      _bc("[DEALER] Dealer value less than 17. Hit");
      game.hit(game.dealer);
    }
    else if (game.dealer.value === 17) {
      // If it is 17 and contains an ace, hit.
      if (game.containsAce(game.dealer.hand)) {
        _bc("[DEALER] Dealer hand contains ace, value is 17. Hit");
        game.hit(game.dealer);
      }
      else {
        _bc("[DEALER] Dealer hand is 17, but has no ace. Stay.");
        game.stay(game.dealer);
      }
    }
    else {
      _bc("[DEALER] Dealer has hand greater than 17. Stay.");
      game.stay(game.dealer);
    }
    _bc("[DEALER] ---------------------- [DEALER]");

  },

  nextRound: function(){
    _bc("Round complete");
    if (game.isGameOver()) {
      game.finishGame();
      return;
    }

    game.currentPlayerIndex++;

    if (game.currentPlayerIndex === game.table.length)
      game.currentPlayer = game.dealer;
    else if (game.currentPlayerIndex === game.table.length+1) {
      game.currentPlayerIndex = 0;
      game.currentPlayer = game.table[0];
    }
    else {
      game.currentPlayer = game.table[game.currentPlayerIndex];
    }

    if (!game.currentPlayer.playing) {
      game.broadcastTable();
      game.nextRound();
      return;
    }

    if (game.currentPlayer === game.dealer) {
      game.playDealer();
      game.firstRound = false;
      game.calculateHands();
      game.broadcastTable();
      broadcast("--------------------------------------------------");
      setTimeout(game.nextRound, (dev?700:2000));
      return;
    }

    if (game.currentPlayer.isAI) {
      game.playAI(game.currentPlayer);
      game.calculateHands();
      game.broadcastTable();
      setTimeout(game.nextRound, (dev?700:2000));
      return;
    }

    game.calculateHands();
    game.broadcastTable();
  },

  isTied: function() {
    var highScore = 0;
    var tiedPlayers = [];
    var newTable = _.clone(game.table);
    newTable.push(game.dealer);

    game.calculateHands();

    for (var i = 0; i < newTable.length; i++) {
      var player = newTable[i];
      if (player.bust)
        continue;
      if (player.value > highScore) {
        tiedPlayers.length = 0;
        tiedPlayers.push(newTable[i]);
        highScore = newTable[i].value;
      }
      else if (player.value === highScore) {
        tiedPlayers.push(newTable[i]);
      }
    }

    return tiedPlayers.length > 1;
  },

  determineWinners: function() {
    var highScore = 0;
    var tiedPlayers = [];
    var newTable = _.clone(game.table);
    newTable.push(game.dealer);

    game.calculateHands();

    // First, find ties
    for (var i = 0; i < newTable.length; i++) {
      var player = newTable[i];
      if (player.bust)
        continue;
      if (player.value > highScore) {
        tiedPlayers.length = 0;
        tiedPlayers.push(newTable[i]);
        highScore = newTable[i].value;
      }
      else if (player.value === highScore) {
        tiedPlayers.push(newTable[i]);
      }
    }

    // Do another pass, removing anyone who has a high card count
    var lowestLength = 999;
    var newTiedPlayers = [];
    for (var j = 0; j < tiedPlayers.length; j++) {
      var p = tiedPlayers[j];
      if (p.hand.length < lowestLength) {
        newTiedPlayers.length = 0;
        newTiedPlayers.push(tiedPlayers[j]);
        lowestLength = tiedPlayers[j].hand.length;
      }
      else if (p.hand.length === lowestLength) {
        newTiedPlayers.push(tiedPlayers[j]);
      }
    }

    for (var k = 0; k < newTiedPlayers.length; k++)
      newTiedPlayers[k].winner = true;

    return newTiedPlayers;
  },

  determineWinner: function() {
    var winner = {};
    var highScore = 0;
    var newTable = _.clone(game.table);
    newTable.push(game.dealer);

    game.calculateHands();

    for (var i = 0; i < newTable.length; i++) {
      var player = newTable[i];
      if (player.bust)
        continue;
      if (player.hand.length === 7) {
        return player;
      }
      if (player.value > highScore) {
        winner = newTable[i];
        highScore = winner.value;
      }
    }

    winner.winner = true;
    return winner;

  },

  isSevenCard: function() {
    var newTable = _.clone(game.table);
    newTable.push(game.dealer);

    game.calculateHands();

    for (var i = 0; i < newTable.length; i++) {
      if (newTable[i].hand.length === 7) {
        return true;
      }
    }
  },

  displayResults: function() {
    if (game.isSevenCard() || !game.isTied()) {
      var winner = game.determineWinner();
      if (game.isSevenCard())
        broadcast("[!] Winner is " + (winner === game.dealer? "Dealer":("Player "+game.table.indexOf(winner)+(winner.isAI?"(AI)":""))) + " with a seven card charlie!");
      else
        broadcast("[!] Winner is " + (winner === game.dealer? "Dealer":("Player "+game.table.indexOf(winner)+(winner.isAI?"(AI)":""))) + " with a score of " + winner.value);
    }
    else {
      var winners = game.determineWinners();
      for (var i = 0; i < winners.length; i++)
        broadcast("    [>] " + (winners[i] === game.dealer? "Dealer":("Player "+game.table.indexOf(winners[i])+(winners[i].isAI?"(AI)":""))));
      if (winners.length === 1) {
        broadcast("[*] However, the player with the lowest card count wins. The winner is...");
      }
      broadcast("[!] There was a tie!");
    }
  },

  finishGame: function() {
    game.inProgress = false;
    broadcast("=============================\n[!] Game over!");
    game.displayResults();

    // For each player, emit the table, minus them

    for (var i = 0; i < game.table.length; i++) {
      if ("sid" in game.table[i]) {
        var data = {};
        var newTable = _.cloneDeep(game.table);
        newTable.splice(i, 1);

        data.players = newTable;
        data.dealer = game.dealer;
        data.me = game.table[i];
        io.sockets.connected[game.table[i].sid].emit('endGame', data);

      }
    }
    if (!game.onlyAI())
      setTimeout(game.start, (dev?1500:5000));
  },

  allPlaying: function() {
    for (var i = 0; i < game.table.length; i++) {
      game.table[i].playing = true;
    }

    game.dealer.playing = true;
  },

  start: function() {
    game.clearBoard();
    game.addFromQueue();
    game.addAI();
    game.deck = game.generateDeck();
    game.deal();
    game.allPlaying();
    game.firstRound = true;
    game.calculateHands();
    game.currentPlayer = game.table[0];
    game.currentPlayerIndex = 0;
    game.inProgress = true;
    game.broadcastTable();

    broadcast("[!] New Game Started!");
  },

  hit: function(player) {
    player.hand.push(game.deck.pop());
    game.calculateHand(player);

    if (player.value > 21) {
      player.playing = false;
      player.bust = true;
    }

    // Check if the player has 7 cards. If so, inProgress = false, win condition is met
    if (!player.bust && player.hand.length === 7) {
      game.inProgress = false;
    }

    broadcast("[>] "+ (player === game.dealer? "Dealer":("Player "+game.table.indexOf(player)+(player.isAI?"(AI)":"")))+" Has Hit"+(player.value>21?" and has BUST!":""));

    game.broadcastTable();
  },

  stay: function(player) {
    broadcast("[>] "+ (player === game.dealer? "Dealer":("Player "+game.table.indexOf(player)+(player.isAI?"(AI)":"")))+" Has Stayed"+(player.value>21?" and has BUST!":""));
    player.playing = false;
    game.broadcastTable();
  },

  split: function(player) {
    broadcast("[>] "+ (player === game.dealer? "Dealer":("Player "+game.table.indexOf(player)+(player.isAI?"(AI)":"")))+" Has Split"+(player.value>21?" and has BUST!":""));
    game.broadcastTable();
  }
};


app.set('view engine', 'ejs');
app.set('views', __dirname + '/public/views');

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session);

app.all('/', function (req, res) {
  req.session.user = {pid: uuid.v4()};
  res.render('pages/index');
});

var httpServer = http.Server(app);
httpServer.listen(port, function() {
  console.log("Server listening on port: ", port);
});

io = require('socket.io').listen(httpServer);
io.use(sharedsession(session, {
  autoSave: true
}));

// New player. Add to queue, start the game if it hasn't started
io.on('connection', function(client) {
  console.log("New user connected: UID " + client.handshake.session.user.pid);
  broadcast("[!] A new player has joined the queue");

  // New player
  var player = {
    pid: client.handshake.session.user.pid,
    hand: [],
    value: 0,
    isAI: false,
    hasSplit: false,
    playing: false,
    sid: client.id,
    bust: false
  };

  game.queuedPlayers.push(player);
  io.sockets.connected[client.id].emit('queued', player);


  // If a game isn't running, start one
  if (!game.inProgress)
    game.start();

  client.on('disconnect', function() {
    game.disconnectPlayer(player);
  });

  client.on('new move', function(move) {
    if (game.currentPlayer !== player)
      return;
    if (move === "hit" && player.canHit) {
      game.hit(player);
    }
    else if (move === "split" && player.canSplit) {
      game.split(player);
    }
    else if (move === "stay" && player.canStay) {
      game.stay(player);
    }
    else
      return;

    game.nextRound();
  });
});
