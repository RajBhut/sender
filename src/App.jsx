import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Import Lucide React icons
import {
  Sun,
  Moon,
  Share2,
  File,
  FolderOpen,
  Download,
  Copy,
  Upload,
  Users,
  Wifi,
  WifiOff,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  X,
} from "lucide-react";

function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [inputRoomId, setInputRoomId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [file, setFile] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [isReceiving, setIsReceiving] = useState(false);
  const [receivedProgress, setReceivedProgress] = useState(0);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light"
  );
  const [dragOver, setDragOver] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);

  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const receivedChunksRef = useRef([]);
  const fileSizeRef = useRef(0);
  const fileNameRef = useRef("");
  const isReceivingRef = useRef(false);

  // Theme handling
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  useEffect(() => {
    const socketUrl =
      import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    newSocket.on("connect", () => {
      setStatus("Connected to server");
    });

    newSocket.on("disconnect", (reason) => {
      setStatus("Disconnected from server");
      setIsConnected(false);
    });

    newSocket.on("reconnect", (attemptNumber) => {
      setStatus("Reconnected to server");
    });

    newSocket.on("reconnect_error", (error) => {
      setStatus("Error reconnecting to server");
    });

    newSocket.on("reconnect_failed", () => {
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
      setRoomId(id);
      setIsHost(true);
      setStatus("Room created! Share this ID with others: " + id);
    });

    socket.on("room-not-found", () => {
      setStatus("Room not found!");
    });

    socket.on("user-joined", (userId) => {
      setStatus("User joined! Initiating connection...");
      createPeerConnection(true, userId);
    });

    socket.on("offer", (offer, userId) => {
      setStatus("Received connection offer...");
      createPeerConnection(false, userId, offer);
    });

    socket.on("answer", (answer) => {
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

    if (isInitiator) {
      const dataChannel = peerConnection.createDataChannel("fileTransfer", {
        ordered: true,
        maxRetransmits: 3,
      });
      setupDataChannel(dataChannel);
      dataChannelRef.current = dataChannel;
    } else {
      peerConnection.ondatachannel = (event) => {
        setupDataChannel(event.channel);
        dataChannelRef.current = event.channel;
      };
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", event.candidate, roomId, userId);
      }
    };

    peerConnection.onconnectionstatechange = () => {
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
    peerConnection.oniceconnectionstatechange = () => {};

    // If we're the initiator, create and send an offer
    if (isInitiator) {
      peerConnection
        .createOffer()
        .then((offer) => peerConnection.setLocalDescription(offer))
        .then(() => {
          socket.emit("offer", peerConnection.localDescription, roomId, userId);
        })
        .catch((error) => {
          console.error("Error creating offer:", error);
          setStatus("Error creating connection offer!");
        });
    }
    // If we're the receiver and have an offer, set it and create an answer
    else if (offer) {
      peerConnection
        .setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => peerConnection.createAnswer())
        .then((answer) => peerConnection.setLocalDescription(answer))
        .then(() => {
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
            isReceivingRef.current = true;
            setReceivedProgress(0);
            receivedChunksRef.current = [];
            fileSizeRef.current = metadata.size;
            fileNameRef.current = metadata.name;
            setStatus(
              `Receiving file: ${metadata.name}${
                metadata.totalFiles > 1
                  ? ` (${metadata.fileIndex}/${metadata.totalFiles})`
                  : ""
              }`
            );
          }
        } catch (e) {
          console.error("Error parsing metadata:", e);
        }
      } else if (data instanceof ArrayBuffer) {
        // If we're receiving a file
        if (isReceivingRef.current) {
          receivedChunksRef.current.push(data);
          const totalChunks = Math.ceil(fileSizeRef.current / 16384);
          const currentProgress =
            (receivedChunksRef.current.length / totalChunks) * 100;
          setReceivedProgress(currentProgress);

          // If we've received all chunks, assemble the file
          if (receivedChunksRef.current.length >= totalChunks) {
            try {
              const blob = new Blob(receivedChunksRef.current);
              // Add to received files array instead of replacing
              setReceivedFiles((prev) => [
                ...prev,
                {
                  blob: blob,
                  name: fileNameRef.current,
                  size: blob.size,
                  receivedAt: new Date(),
                },
              ]);
              setIsReceiving(false);
              isReceivingRef.current = false;
              setReceivedProgress(100);
              setStatus("File received successfully!");
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

  // File/Folder handling functions
  const handleFileSelect = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setFolderFiles([]);
    }
  };

  const handleFolderSelect = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length > 0) {
      setFolderFiles(files);
      setFile(null);
      setTotalFiles(files.length);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);

    const items = e.dataTransfer.items;
    const files = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        files.push(file);
      }
    }

    if (files.length === 1) {
      setFile(files[0]);
      setFolderFiles([]);
    } else if (files.length > 1) {
      setFolderFiles(files);
      setFile(null);
      setTotalFiles(files.length);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileExtension = (filename) => {
    return filename.split(".").pop().toUpperCase();
  };

  const sendFiles = async () => {
    const filesToSend = folderFiles.length > 0 ? folderFiles : [file];
    if (filesToSend.length === 0 || !dataChannelRef.current || !isConnected) {
      console.error(
        "Cannot send files: missing files, data channel, or not connected"
      );
      return;
    }

    setProgress(0);
    setStatus("Preparing to send files...");

    for (let i = 0; i < filesToSend.length; i++) {
      const currentFile = filesToSend[i];
      setCurrentFileIndex(i + 1);

      // Send file metadata
      const metadata = {
        type: "file-metadata",
        name: currentFile.name,
        size: currentFile.size,
        fileIndex: i + 1,
        totalFiles: filesToSend.length,
      };

      try {
        dataChannelRef.current.send(JSON.stringify(metadata));
        setStatus(
          `Sending file ${i + 1}/${filesToSend.length}: ${currentFile.name}`
        );
      } catch (error) {
        console.error("Error sending metadata:", error);
        setStatus("Error sending file metadata!");
        return;
      }

      // Wait a bit before sending file chunks
      await new Promise((resolve) => setTimeout(resolve, 500));

      await sendSingleFile(currentFile, i + 1, filesToSend.length);

      // Wait between files
      if (i < filesToSend.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    setStatus("All files sent successfully!");
    setProgress(100);
  };

  const sendSingleFile = (fileToSend, fileIndex, totalFiles) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = (error) => {
        console.error("Error reading file:", error);
        setStatus("Error reading file!");
        reject(error);
      };

      reader.onload = (e) => {
        const chunkSize = 16384; // 16KB chunks
        const data = e.target.result;
        const totalChunks = Math.ceil(data.byteLength / chunkSize);
        let sentChunks = 0;

        const sendChunk = (start) => {
          if (start >= data.byteLength) {
            console.log(`File ${fileIndex}/${totalFiles} sent completely`);
            resolve();
            return;
          }

          try {
            const chunk = data.slice(start, start + chunkSize);
            dataChannelRef.current.send(chunk);
            sentChunks++;
            const fileProgress = (sentChunks / totalChunks) * 100;
            const overallProgress =
              ((fileIndex - 1) / totalFiles) * 100 + fileProgress / totalFiles;
            setProgress(overallProgress);

            setTimeout(() => sendChunk(start + chunkSize), 50);
          } catch (error) {
            console.error("Error sending chunk:", error);
            setStatus("Error sending file chunk!");
            reject(error);
          }
        };

        sendChunk(0);
      };

      reader.readAsArrayBuffer(fileToSend);
    });
  };

  const downloadFile = (file) => {
    if (!file) return;

    console.log(`Downloading file: ${file.name}, size: ${file.size} bytes`);

    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAllFiles = () => {
    receivedFiles.forEach((file, index) => {
      setTimeout(() => downloadFile(file), index * 100);
    });
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
    setFolderFiles([]);
    setProgress(0);
    setReceivedFiles([]);
    setIsReceiving(false);
    setReceivedProgress(0);
    setCurrentFileIndex(0);
    setTotalFiles(0);
    receivedChunksRef.current = [];
    fileSizeRef.current = 0;
    fileNameRef.current = "";
    isReceivingRef.current = false;
    setStatus("File transfer reset");
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <h1>Sender</h1>
        </div>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </header>

      {/* Main Container */}
      <div className="main-container slide-in">
        {!roomId ? (
          <div className="room-creation">
            <h2>Start Sharing</h2>
            <p>
              Create a room to share files securely with peer-to-peer connection
            </p>

            <div className="button-group">
              <button className="btn btn-primary" onClick={createRoom}>
                <Share2 size={18} /> Create Room
              </button>
            </div>

            <div className="input-group">
              <input
                type="text"
                className="input"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                placeholder="Enter Room ID to join"
              />
              <button className="btn btn-secondary" onClick={joinRoom}>
                Join Room
              </button>
            </div>
          </div>
        ) : (
          <div className="room-info">
            <div className="room-header">
              <div className="room-id-container">
                <div className="room-id">#{roomId}</div>
                <button className="btn btn-secondary" onClick={copyRoomId}>
                  <Copy size={16} /> Copy ID
                </button>
              </div>
              <div
                className={`status ${
                  isConnected
                    ? "connected"
                    : status.includes("Connecting")
                    ? "connecting"
                    : "disconnected"
                }`}
              >
                {isConnected ? (
                  <Wifi size={16} />
                ) : status.includes("Connecting") ? (
                  <AlertCircle size={16} />
                ) : (
                  <WifiOff size={16} />
                )}
                {status}
              </div>
            </div>

            {isConnected && (
              <div className="file-sharing">
                {/* File Drop Zone */}
                <div
                  className={`file-drop-zone ${dragOver ? "drag-over" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="drop-icon">
                    <Upload size={48} />
                  </div>
                  <h3>Drop files here or click to select</h3>
                  <p>Support for single files and multiple files</p>

                  <div className="button-group" style={{ marginTop: "1rem" }}>
                    <button
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <File size={16} /> Select Files
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        folderInputRef.current?.click();
                      }}
                    >
                      <FolderOpen size={16} /> Select Folder
                    </button>
                  </div>
                </div>

                {/* Hidden file inputs */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                  multiple
                />
                <input
                  type="file"
                  ref={folderInputRef}
                  onChange={handleFolderSelect}
                  style={{ display: "none" }}
                  webkitdirectory=""
                  multiple
                />

                {/* Selected Files Display */}
                {(file || folderFiles.length > 0) && (
                  <div
                    className={`file-item ${
                      progress > 0 && progress < 100
                        ? "sending"
                        : progress === 100
                        ? "completed"
                        : ""
                    }`}
                  >
                    <div className="file-header">
                      <div className="file-info-content">
                        <div className="file-icon">
                          {folderFiles.length > 0 ? (
                            <FolderOpen size={24} />
                          ) : (
                            getFileExtension(file?.name || "")
                          )}
                        </div>
                        <div className="file-details">
                          <h4>
                            {folderFiles.length > 0
                              ? `${folderFiles.length} files selected`
                              : file?.name}
                          </h4>
                          <p>
                            {folderFiles.length > 0
                              ? formatFileSize(
                                  folderFiles.reduce(
                                    (total, f) => total + f.size,
                                    0
                                  )
                                )
                              : formatFileSize(file?.size || 0)}
                          </p>
                        </div>
                      </div>
                      <button
                        className="btn btn-success"
                        onClick={sendFiles}
                        disabled={progress > 0 && progress < 100}
                      >
                        <Upload size={16} /> Send
                      </button>
                    </div>

                    {progress > 0 && (
                      <div className="progress-container">
                        <div className="progress-label">
                          <span>
                            {folderFiles.length > 0 && currentFileIndex > 0
                              ? `Sending file ${currentFileIndex}/${totalFiles}`
                              : "Sending..."}
                          </span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="progress-bar">
                          <div
                            className={`progress ${
                              progress === 100 ? "success" : ""
                            }`}
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}

                    {folderFiles.length > 0 && (
                      <div className="folder-container">
                        <h5>Files in folder:</h5>
                        {folderFiles.slice(0, 5).map((f, index) => (
                          <div key={index} className="folder-item">
                            <div className="folder-icon">
                              {getFileExtension(f.name)}
                            </div>
                            <span>{f.name}</span>
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: "0.8rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              {formatFileSize(f.size)}
                            </span>
                          </div>
                        ))}
                        {folderFiles.length > 5 && (
                          <p
                            style={{
                              textAlign: "center",
                              color: "var(--text-muted)",
                              fontSize: "0.875rem",
                            }}
                          >
                            ... and {folderFiles.length - 5} more files
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Receiving Files Display */}
                {isReceiving && (
                  <div className="file-item receiving">
                    <div className="file-header">
                      <div className="file-info-content">
                        <div className="file-icon">
                          {getFileExtension(fileNameRef.current)}
                        </div>
                        <div className="file-details">
                          <h4>Receiving: {fileNameRef.current}</h4>
                          <p>{formatFileSize(fileSizeRef.current)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="progress-container">
                      <div className="progress-label">
                        <span>Receiving...</span>
                        <span>{Math.round(receivedProgress)}%</span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress warning"
                          style={{ width: `${receivedProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Received Files Display */}
                {receivedFiles.length > 0 && (
                  <div className="received-files-section">
                    <div className="section-header">
                      <h3>Received Files ({receivedFiles.length})</h3>
                      {receivedFiles.length > 1 && (
                        <button
                          className="btn btn-secondary"
                          onClick={downloadAllFiles}
                        >
                          <Download size={16} /> Download All
                        </button>
                      )}
                    </div>
                    {receivedFiles.map((file, index) => (
                      <div key={index} className="file-item completed">
                        <div className="file-header">
                          <div className="file-info-content">
                            <div className="file-icon">
                              {getFileExtension(file.name)}
                            </div>
                            <div className="file-details">
                              <h4>{file.name}</h4>
                              <p>
                                {formatFileSize(file.size)} • Received
                                {file.receivedAt &&
                                  ` at ${file.receivedAt.toLocaleTimeString()}`}
                              </p>
                            </div>
                          </div>
                          <button
                            className="btn btn-success"
                            onClick={() => downloadFile(file)}
                          >
                            <Download size={16} /> Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reset Button */}
                {(file ||
                  folderFiles.length > 0 ||
                  isReceiving ||
                  receivedFiles.length > 0) && (
                  <div style={{ textAlign: "center", marginTop: "2rem" }}>
                    <button
                      className="btn btn-danger"
                      onClick={resetFileTransfer}
                    >
                      <RotateCcw size={16} /> Reset Transfer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
