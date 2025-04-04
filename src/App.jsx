import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [receivedFile, setReceivedFile] = useState(null);
  const [receivedFileName, setReceivedFileName] = useState("");
  const [isReceiving, setIsReceiving] = useState(false);
  const [receivedProgress, setReceivedProgress] = useState(0);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileInputRef = useRef(null);
  const receivedChunksRef = useRef([]);
  const fileSizeRef = useRef(0);
  const fileNameRef = useRef("");

  useEffect(() => {
    const socketUrl = import.meta.env.PROD
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
          window.location.host
        }`
      : "http://localhost:3001";

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    newSocket.on("connect", () => {
      console.log("Socket connected successfully");
      setStatus("Connected to server");
    });

    newSocket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      setStatus("Disconnected from server");
      setIsConnected(false);
    });

    newSocket.on("reconnect", (attemptNumber) => {
      console.log("Socket reconnected after", attemptNumber, "attempts");
      setStatus("Reconnected to server");
    });

    newSocket.on("reconnect_error", (error) => {
      console.error("Socket reconnection error:", error);
      setStatus("Error reconnecting to server");
    });

    newSocket.on("reconnect_failed", () => {
      console.error("Socket reconnection failed");
      setStatus("Failed to reconnect to server");
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on("room-created", (id) => {
      console.log("Room created:", id);
      setRoomId(id);
      setIsHost(true);
      setStatus("Room created! Share this ID with others: " + id);
    });

    socket.on("room-not-found", () => {
      console.log("Room not found");
      setStatus("Room not found!");
    });

    socket.on("user-joined", (userId) => {
      console.log("User joined:", userId);
      setStatus("User joined! Initiating connection...");
      createPeerConnection(true, userId);
    });

    socket.on("offer", (offer, userId) => {
      console.log("Received offer from:", userId);
      setStatus("Received connection offer...");
      createPeerConnection(false, userId, offer);
    });

    socket.on("answer", (answer) => {
      console.log("Received answer");
      if (peerConnectionRef.current) {
        peerConnectionRef.current
          .setRemoteDescription(new RTCSessionDescription(answer))
          .catch((error) => {
            console.error("Error setting remote description:", error);
          });
      } else {
        console.error("No peer connection available for answer");
      }
    });

    socket.on("ice-candidate", (candidate) => {
      console.log("Received ICE candidate");
      if (peerConnectionRef.current) {
        peerConnectionRef.current
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch((error) => {
            console.error("Error adding ICE candidate:", error);
          });
      } else {
        console.error("No peer connection available for ICE candidate");
      }
    });

    socket.on("host-disconnected", () => {
      console.log("Host disconnected");
      setStatus("Host disconnected!");
      setIsConnected(false);
      setRoomId("");
      setIsHost(false);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
        dataChannelRef.current = null;
      }
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      setStatus("Connection error: " + error.message);
    });

    return () => {
      socket.off("room-created");
      socket.off("room-not-found");
      socket.off("user-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("host-disconnected");
      socket.off("connect_error");
    };
  }, [socket, roomId]);

  const createPeerConnection = (isInitiator, userId, offer = null) => {
    const configuration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
      iceCandidatePoolSize: 10,
    };

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionRef.current = peerConnection;

    // Set up data channel
    if (isInitiator) {
      console.log("Creating data channel as initiator");
      const dataChannel = peerConnection.createDataChannel("fileTransfer", {
        ordered: true,
        maxRetransmits: 3,
      });
      setupDataChannel(dataChannel);
      dataChannelRef.current = dataChannel;
    } else {
      console.log("Waiting for data channel as receiver");
      peerConnection.ondatachannel = (event) => {
        console.log("Data channel received");
        setupDataChannel(event.channel);
        dataChannelRef.current = event.channel;
      };
    }

    // ICE candidate handling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Sending ICE candidate");
        socket.emit("ice-candidate", event.candidate, roomId, userId);
      }
    };

    // Connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log("Connection state changed:", peerConnection.connectionState);
      if (peerConnection.connectionState === "connected") {
        setIsConnected(true);
        setStatus("Connected! You can now send files.");
      } else if (
        peerConnection.connectionState === "disconnected" ||
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        setIsConnected(false);
        setStatus("Connection lost!");
      }
    };

    // ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", peerConnection.iceConnectionState);
    };

    // If we're the initiator, create and send an offer
    if (isInitiator) {
      console.log("Creating offer as initiator");
      peerConnection
        .createOffer()
        .then((offer) => peerConnection.setLocalDescription(offer))
        .then(() => {
          console.log("Sending offer");
          socket.emit("offer", peerConnection.localDescription, roomId, userId);
        })
        .catch((error) => {
          console.error("Error creating offer:", error);
          setStatus("Error creating connection offer!");
        });
    }
    // If we're the receiver and have an offer, set it and create an answer
    else if (offer) {
      console.log("Setting remote description and creating answer");
      peerConnection
        .setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => peerConnection.createAnswer())
        .then((answer) => peerConnection.setLocalDescription(answer))
        .then(() => {
          console.log("Sending answer");
          socket.emit(
            "answer",
            peerConnection.localDescription,
            roomId,
            userId
          );
        })
        .catch((error) => {
          console.error("Error creating answer:", error);
          setStatus("Error creating connection answer!");
        });
    }
  };

  const setupDataChannel = (dataChannel) => {
    dataChannel.onopen = () => {
      console.log("Data channel opened");
    };

    dataChannel.onclose = () => {
      console.log("Data channel closed");
    };

    dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
    };

    // Handle incoming data
    dataChannel.onmessage = (event) => {
      const data = event.data;
      console.log(
        "Received data type:",
        typeof data,
        data instanceof ArrayBuffer ? "ArrayBuffer" : "string"
      );

      // Check if this is a file metadata message
      if (typeof data === "string") {
        try {
          const metadata = JSON.parse(data);
          if (metadata.type === "file-metadata") {
            // Start receiving a new file
            console.log("Received file metadata:", metadata);
            setIsReceiving(true);
            setReceivedProgress(0);
            receivedChunksRef.current = [];
            fileSizeRef.current = metadata.size;
            fileNameRef.current = metadata.name;
            setStatus(`Receiving file: ${metadata.name}`);
          }
        } catch (e) {
          console.error("Error parsing metadata:", e);
        }
      } else if (data instanceof ArrayBuffer) {
        // If we're receiving a file
        if (isReceiving) {
          receivedChunksRef.current.push(data);
          const totalChunks = Math.ceil(fileSizeRef.current / 16384);
          const currentProgress =
            (receivedChunksRef.current.length / totalChunks) * 100;
          setReceivedProgress(currentProgress);
          console.log(
            `Received chunk ${
              receivedChunksRef.current.length
            }/${totalChunks} (${currentProgress.toFixed(2)}%)`
          );

          // If we've received all chunks, assemble the file
          if (receivedChunksRef.current.length >= totalChunks) {
            console.log("All chunks received, assembling file...");
            try {
              const blob = new Blob(receivedChunksRef.current);
              setReceivedFile(blob);
              setReceivedFileName(fileNameRef.current);
              setIsReceiving(false);
              setReceivedProgress(100);
              setStatus("File received successfully!");
              console.log("File assembled successfully, size:", blob.size);
            } catch (error) {
              console.error("Error assembling file:", error);
              setStatus("Error assembling file!");
            }
          }
        } else {
          console.warn("Received file chunk but not in receiving state");
        }
      }
    };
  };

  const createRoom = () => {
    socket.emit("create-room");
  };

  const joinRoom = () => {
    if (inputRoomId) {
      setRoomId(inputRoomId);
      socket.emit("join-room", inputRoomId);
    }
  };

  const handleFileSelect = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const sendFile = () => {
    if (!file || !dataChannelRef.current || !isConnected) {
      console.error(
        "Cannot send file: missing file, data channel, or not connected"
      );
      return;
    }

    // Reset progress
    setProgress(0);
    setStatus("Preparing to send file...");

    // First send file metadata
    const metadata = {
      type: "file-metadata",
      name: file.name,
      size: file.size,
    };
    console.log("Sending file metadata:", metadata);

    try {
      dataChannelRef.current.send(JSON.stringify(metadata));
      setStatus("Metadata sent, preparing file chunks...");
    } catch (error) {
      console.error("Error sending metadata:", error);
      setStatus("Error sending file metadata!");
      return;
    }

    // Add a small delay to ensure metadata is processed before sending chunks
    setTimeout(() => {
      const reader = new FileReader();

      reader.onerror = (error) => {
        console.error("Error reading file:", error);
        setStatus("Error reading file!");
      };

      reader.onload = (e) => {
        const chunkSize = 16384; // 16KB chunks
        const data = e.target.result;
        const totalChunks = Math.ceil(data.byteLength / chunkSize);
        let sentChunks = 0;

        console.log(`Starting to send file in ${totalChunks} chunks`);
        setStatus(`Sending file: ${file.name} (0/${totalChunks} chunks)`);

        const sendChunk = (start) => {
          if (start >= data.byteLength) {
            console.log("File sent completely");
            setStatus("File sent successfully!");
            setProgress(100);
            return;
          }

          try {
            const chunk = data.slice(start, start + chunkSize);
            dataChannelRef.current.send(chunk);
            sentChunks++;
            const currentProgress = (sentChunks / totalChunks) * 100;
            setProgress(currentProgress);
            setStatus(
              `Sending file: ${file.name} (${sentChunks}/${totalChunks} chunks)`
            );
            console.log(
              `Sent chunk ${sentChunks}/${totalChunks} (${currentProgress.toFixed(
                2
              )}%)`
            );

            // Use a small delay to prevent overwhelming the data channel
            setTimeout(() => sendChunk(start + chunkSize), 50);
          } catch (error) {
            console.error("Error sending chunk:", error);
            setStatus("Error sending file chunk!");
          }
        };

        sendChunk(0);
      };

      reader.readAsArrayBuffer(file);
    }, 500); // 500ms delay to ensure metadata is processed
  };

  const downloadReceivedFile = () => {
    if (!receivedFile) return;

    // Verify file size matches what was expected
    if (receivedFile.size !== fileSizeRef.current) {
      console.warn(
        `File size mismatch: expected ${fileSizeRef.current} bytes, got ${receivedFile.size} bytes`
      );
      setStatus("Warning: File size mismatch. The file may be corrupted.");
    } else {
      console.log(`File size verified: ${receivedFile.size} bytes`);
    }

    const url = URL.createObjectURL(receivedFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = receivedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyRoomId = () => {
    navigator.clipboard
      .writeText(roomId)
      .then(() => {
        setStatus("Room ID copied to clipboard!");
        setTimeout(() => {
          if (isConnected) {
            setStatus("Connected! You can now send files.");
          }
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy room ID: ", err);
      });
  };

  const resetFileTransfer = () => {
    setFile(null);
    setProgress(0);
    setReceivedFile(null);
    setReceivedFileName("");
    setIsReceiving(false);
    setReceivedProgress(0);
    receivedChunksRef.current = [];
    fileSizeRef.current = 0;
    fileNameRef.current = "";
    setStatus("File transfer reset");
  };

  return (
    <div className="app">
      <h1>P2P File Sharing</h1>

      {!roomId ? (
        <div className="room-creation">
          <button onClick={createRoom}>Create Room</button>
          <div className="join-room">
            <input
              type="text"
              value={inputRoomId}
              onChange={(e) => setInputRoomId(e.target.value)}
              placeholder="Enter Room ID"
            />
            <button onClick={joinRoom}>Join Room</button>
          </div>
        </div>
      ) : (
        <div className="room-info">
          <div className="room-id-container">
            <h2>Room ID: {roomId}</h2>
            <button className="copy-button" onClick={copyRoomId}>
              Copy Room ID
            </button>
          </div>
          <p>Status: {status}</p>

          {isConnected && (
            <div className="file-sharing">
              <input
                type="file"
                onChange={handleFileSelect}
                ref={fileInputRef}
                style={{ display: "none" }}
              />
              <button onClick={() => fileInputRef.current.click()}>
                Select File
              </button>

              {file && (
                <div className="file-info">
                  <p>Selected file: {file.name}</p>
                  <button onClick={sendFile}>Send File</button>
                  {progress > 0 && (
                    <div className="progress-bar">
                      <div
                        className="progress"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {isReceiving && (
                <div className="file-info receiving">
                  <p>Receiving file: {fileNameRef.current}</p>
                  <div className="progress-bar">
                    <div
                      className="progress"
                      style={{ width: `${receivedProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {receivedFile && (
                <div className="file-info received">
                  <p>File received: {receivedFileName}</p>
                  <button onClick={downloadReceivedFile}>Download File</button>
                </div>
              )}

              {(file || isReceiving || receivedFile) && (
                <button className="reset-button" onClick={resetFileTransfer}>
                  Reset File Transfer
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
