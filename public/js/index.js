var blackJackApp = angular.module('blackJackApp', ['ngRoute', 'ngMaterial']);

blackJackApp.factory('socket', ['$rootScope', function ($rootScope) {
  var socket = io.connect();

  return {
    on: function (eventName, callback) {
          function wrapper() {
            var args = arguments;
              $rootScope.$apply(function () {
                callback.apply(socket, args);
            });
          }

          socket.on(eventName, wrapper);

          return function () {
            socket.removeListener(eventName, wrapper);
          };
        },

  emit: function (eventName, data, callback) {
          socket.emit(eventName, data, function () {
            var args = arguments;
            $rootScope.$apply(function () {
              if(callback) {
                callback.apply(socket, args);
              }
            });
          });
        }
  };
}]);

blackJackApp.config(['$routeProvider', '$mdThemingProvider', function($routeProvider, $mdThemingProvider) {
  $routeProvider.when('/', {
    templateUrl: '/',
    controller: 'mainController'
  });

  $mdThemingProvider.theme('default').primaryPalette('pink').accentPalette('light-blue');

}]);

blackJackApp.controller('mainController', function($scope, socket) {
  $scope.hand = [];
  $scope.id = -1;
  $scope.value = 0;
  $scope.myTurn = false;
  $scope.canHit = false;
  $scope.canStay = false;
  $scope.canSplit = false;
  $scope.queued = true;
  $scope.name = "Me";
  $scope.bust = false;
  $scope.logs = "[#] Welcome to Let's Play BlackJack. Connor's lowsy attempt at a multiplayer blackjack! :D";

  var validMove = function(move) {
    return move === "hit" || move === "split" || move === "stay";
  };

  $scope.makeMove = function(moveType) {
    if (!validMove(moveType))
      return;
    socket.emit("new move", moveType);
  };

  // Listeners/Emitters
  socket.on("new message", function(message) {
    $scope.logs = message.concat("\n" + $scope.logs);
  });

  socket.on("queued", function(me) {
    $scope.queued = true;
  });

  socket.on("endGame", function(data) {
    $scope.dealer = data.dealer;
    $scope.players = data.players;
    $scope.winner = data.me.winner;

    console.log(data.me.winner);
  });

  socket.on("begin", function(data){
    $scope.queued = false;
  });

  // when a turn is played, refresh the table data
  socket.on("turnPlayed", function(data) {
    $scope.hand = data.me.hand;
    $scope.dealer = data.dealer;
    $scope.players = data.players;
    $scope.myTurn = data.myTurn;
    $scope.value = data.me.value;
    $scope.canHit = data.me.canHit;
    $scope.canStay = data.me.canStay;
    $scope.canSplit = data.me.canSplit;
    $scope.bust = data.me.bust;
    $scope.name = data.me.name;
    $scope.winner = data.me.winner;
  });

});
