const Trello = require('node-trello');

module.exports = function (RED) {
  function TrelloGetCardMovedToListNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const nodeContext = this.context();

    // Retrieve the config node
    const credentialNode = RED.nodes.getNode(config.trello);
    const trello = new Trello(credentialNode.apikey, credentialNode.token);


    this.on('input', function (msg) {
      //<editor-fold desc="Initialise all variables">
      const trelloCurrentUserIDSaveString = 'trelloUID';
      const lastFetchedSaveString = 'lastFetched';
      const boardFetchesSaveString = 'boardFetches';
      const listId = config.idList;
      const boardId = config.idBoard;
      const safeListBlockListUsers = config.safeListBlockListUsers;
      const filterUserList = config.filterUserList;
      const excludeSelfCreated = config.excludeUser;
      let trelloCurrentUserID = '';
      try {
        trelloCurrentUserID = nodeContext.get(trelloCurrentUserIDSaveString);
      } catch (e) {
        node.error(e)
      }
      let lastFetchedISO = '';
      try {
        lastFetchedISO = nodeContext.get(lastFetchedSaveString);
      } catch (e) {
        node.error(e)
      }
      // Board fetches contains a set of timestamps each board was last fetched
      let boardFetchesDictISO = {};
      try {
        boardFetchesDictISO = nodeContext.get(boardFetchesSaveString);
      } catch (e) {
        node.error(e)
      }
      // The get call doesn't error if empty, it just sets the verible to null so reset it to an empty dict
      if (!boardFetchesDictISO) {
        boardFetchesDictISO = {};
      }

      if (!lastFetchedISO) {
        if (msg.payload.initialTimeStamp) {
          lastFetchedISO = msg.payload.initialTimeStamp;
          node.warn('Used initialTimeStamp input to set the starting point. This could cause some duplication.');
        }
      }
      //</editor-fold>

      // pre check that we have the current user ID associated with the api key, if not we shall go fetch it.
      // TODO I may want to set a flag if the credentials have changed as that would change the user
      function getTrelloCurrentUID() {
        if (trelloCurrentUserID) {
          main();
        } else {
          trello.get('/1/members/me', (err, data) => {
            if (err) {
              node.error(err);
            } else {
              trelloCurrentUserID = data.id;
              nodeContext.set(trelloCurrentUserIDSaveString, trelloCurrentUserID); // store for faster access
              main();
            }
          })
        }
      }

      // Main method, called after checking current Trello user ID in getTrelloCurrentUID.
      function main() {
        const triggeredDate = new Date();
        if (lastFetchedISO) {
          if (listId) {
            trello.get('/1/lists/' + listId + '/actions', {since: lastFetchedISO, before: triggeredDate.toISOString()},
              (err, data) => {
                if (err) {
                  node.error(err)
                } else {
                  outputNewCards(data, listId);
                  setLastFetched(triggeredDate, boardId);
                  node.status({fill: "green", shape: "dot", text: triggeredDate.toISOString().substring(0, 19)});
                }
              }
            );

          }
        } else {
          // Set the first last fetched so next time I know the window of time to check for new cards.
          setLastFetched(triggeredDate);
        }
      }

      // Filters action json data and get any cards created, to then be sent as a msg.payload. Called from main.
      function outputNewCards(actionData, listId) {
        for (let i = 0; i < actionData.length; i++) {
          if (actionData[i].data) {
            if (actionData[i].type === 'updateCard') {
              if (checkSafeBlockList(actionData[i])) {
                // Bellow will test if excludeSelfCreated is set, if it wasn't it will just continue, if it was it will
                // check that the user that created the card is not the user who's linked to (owns) the API key
                if (!excludeSelfCreated || !(actionData[i].idMemberCreator === trelloCurrentUserID)) {
                  // Bellow looks for any action data that contains a listAfter and list before key signifying a card has been moved
                  if (actionData[i].data.listAfter && actionData[i].data.listBefore) {  // Is it best to just check for undefined?
                    // Bellow checks if the list the card was moved to was the list specified by the user
                    if (actionData[i].data.listAfter.id === listId) {
                      trello.get('/1/cards/' + actionData[i].data.card.id, (err, data) => {
                          if (err) {
                            node.error(err)
                          } else {
                            node.send({payload: data});
                          }
                        }
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }

      function checkSafeBlockList(action) {
        if (safeListBlockListUsers === 'safe') {
          for (let j = 0; j < filterUserList.length; j++) {
            if (action.idMemberCreator === filterUserList[j]) {
              return true;
            }
          }
          return false;
        } else {
          let sendMessage = true;
          for (let j = 0; j < filterUserList.length; j++) {
            if (action.idMemberCreator === filterUserList[j]) {
              sendMessage = false;
              break;
            }
          }
          return sendMessage;
        }
      }

      // Sets last fetched data, Called from main.
      function setLastFetched(triggeredDate, boardID) {
        // Set to triggered time so we can be sure not to miss any
        nodeContext.set(lastFetchedSaveString, triggeredDate.toISOString());

        if (boardID) {
          boardFetchesDictISO[boardID] = triggeredDate.toISOString();
          nodeContext.set(boardFetchesSaveString, boardFetchesDictISO);

        }
      }


      getTrelloCurrentUID();

    })
  }


  RED.nodes.registerType('trelloGetCardMovedToList', TrelloGetCardMovedToListNode);
};
