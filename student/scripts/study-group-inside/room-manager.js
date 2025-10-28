// RoomManager class (ES module) — FIXED: Auto-join + proper participant loading
import { db } from "./firebase-init.js";
import { fetchJsonWithAuth, postJsonWithAuth } from "../apiClient.js";

export class RoomManager {
  constructor(userAuth) {
    this.userAuth = userAuth;
    this.currentRoomData = null;
    this.isOwner = false;
    this.participants = [];
    this.isLoading = true;
  }

  async loadRoomData() {
    this.isLoading = true;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get("room");

      if (!roomId) {
        console.error("[room-manager] No room ID in URL");
        throw new Error("Room ID not found in URL");
      }

      console.log(`[room-manager] Loading room: ${roomId}`);

      const apiUrl = `${window.__CONFIG__.apiBase}/${roomId}`;
      console.log(`[room-manager] Fetching from: ${apiUrl}`);

      const data = await fetchJsonWithAuth(apiUrl, {
        method: "GET",
      });

      if (!data) {
        throw new Error("No room data returned");
      }

      console.log(`[room-manager] Room loaded successfully:`, data);
      this.currentRoomData = data;
      this.isOwner =
        this.currentRoomData.creator === this.userAuth.currentUser.uid;

      // ✅ NEW: Auto-join if not already a participant
      await this.autoJoinRoom();

      await this.loadParticipantsInfo();
      this.isLoading = false;
      return this.currentRoomData;
    } catch (err) {
      console.error("[room-manager] Error loading room:", err);
      this.isLoading = false;

      if (typeof window.showToast === "function") {
        window.showToast(`Failed to load room: ${err.message}`, "error");
      }

      setTimeout(() => {
        window.location.href = "study-rooms.html";
      }, 2000);

      throw err;
    }
  }

  // ✅ NEW: Auto-join room if not already a participant
  async autoJoinRoom() {
    try {
      const currentUid = this.userAuth.currentUser?.uid;
      const participants = this.currentRoomData?.participants || [];

      // If already in participants, skip joining
      if (participants.includes(currentUid)) {
        console.log(`[room-manager] User already in room participants`);
        return;
      }

      // Not in participants - join now!
      const roomId = this.currentRoomData._id || this.currentRoomData.id;
      console.log(`[room-manager] Auto-joining room: ${roomId}`);

      const joinResponse = await postJsonWithAuth(
        `${window.__CONFIG__.apiBase}/${roomId}/join`,
        {}
      );

      console.log(
        `[room-manager] Successfully joined room. Participants count:`,
        joinResponse.participantCount
      );

      // Update local room data with new participants
      this.currentRoomData.participants = [...participants, currentUid];
    } catch (err) {
      console.warn(
        "[room-manager] Auto-join failed (may already be member):",
        err
      );
      // Don't throw - user might already be in room
    }
  }

  async loadParticipantsInfo() {
    try {
      this.participants = [];
      const currentUid = this.userAuth.currentUser?.uid;

      // ✅ FIXED: Check if participants array exists AND has items
      if (
        !this.currentRoomData?.participants ||
        !Array.isArray(this.currentRoomData.participants) ||
        this.currentRoomData.participants.length === 0
      ) {
        console.log("[room-manager] No participants, loading self only");
        const selfInfo = await this.userAuth.getUserDisplayInfo(currentUid);
        this.participants = [
          {
            id: currentUid,
            name: selfInfo.displayName,
            avatar: selfInfo.avatar,
            photo:
              this.userAuth.currentUser.photoURL ||
              this.userAuth.currentUser.photo ||
              null,
            status: "online",
            isHost: this.isOwner,
            inCall: false,
          },
        ];
        this.updateParticipantsList();
        return;
      }

      // ✅ FIXED: Get all participant UIDs
      const uids = Array.from(
        new Set(this.currentRoomData.participants.filter(Boolean))
      );

      console.log(`[room-manager] Loading ${uids.length} participants:`, uids);

      // ✅ FIXED: Batch fetch ALL participant display infos
      const infosMap = await this.userAuth.getUserDisplayInfos(uids);

      console.log(
        "[room-manager] Fetched participant infos:",
        Object.keys(infosMap)
      );

      this.participants = await Promise.all(
        uids.map(async (uid) => {
          try {
            // ✅ FIXED: Use infosMap first, then fallback
            const info = infosMap[uid] || {
              displayName: await this.userAuth
                .getUserDisplayInfo(uid)
                .then((u) => u.displayName),
              avatar: "U",
              photo: null,
            };

            let photo = null;
            if (uid === currentUid) {
              photo =
                this.userAuth.currentUser.photoURL ||
                this.userAuth.currentUser.photo ||
                info.photo ||
                null;
            } else {
              photo = info.photo || null;
              if (!photo) {
                try {
                  const doc = await db.collection("users").doc(uid).get();
                  if (doc.exists && doc.data().photo) photo = doc.data().photo;
                } catch (e) {
                  // ignore read errors
                }
              }
            }

            return {
              id: uid,
              name: info.displayName || uid.substring(0, 8),
              avatar: info.avatar || "U",
              photo: photo,
              status: "online",
              isHost: this.currentRoomData.creator === uid,
              inCall: false,
            };
          } catch (err) {
            console.error("Error building participant info for", uid, err);
            return {
              id: uid,
              name: uid.substring(0, 8),
              avatar: "U",
              photo: null,
              status: "online",
              isHost: this.currentRoomData.creator === uid,
              inCall: false,
            };
          }
        })
      );

      console.log("[room-manager] Participants loaded:", this.participants);
      this.updateParticipantsList();
    } catch (err) {
      console.error("[room-manager] Error loading participants:", err);
    }
  }

  updateParticipantsList() {
    const participantsList = document.getElementById("participantsList");
    if (!participantsList) return;

    participantsList.innerHTML = this.participants
      .map((p) => {
        const isCurrent = p.id === this.userAuth.currentUser.uid;
        // ✅ FIXED: Only show kick button if OWNER (not current user)
        const canKick = this.isOwner && !isCurrent;

        const avatarHtml = p.photo
          ? `<div class="participant-avatar" style="background-image: url('${
              p.photo
            }'); background-size: cover; background-position: center;"><div class="status-indicator ${
              p.inCall ? "status-in-call" : "status-online"
            }"></div></div>`
          : `<div class="participant-avatar">${
              p.avatar
            }<div class="status-indicator ${
              p.inCall ? "status-in-call" : "status-online"
            }"></div></div>`;

        return `<div class="participant-item" data-user-id="${
          p.id
        }">${avatarHtml}<div class="participant-info"><div class="participant-name">${
          p.name
        }${isCurrent ? " (You)" : ""}</div><div class="participant-status">${
          p.isHost ? "Host" : p.inCall ? "In Call" : "Online"
        }</div></div>${
          canKick
            ? `<div class="participant-actions"><button class="kick-btn" onclick="window.kickParticipant('${p.id}')" title="Kick user"><i class="bi bi-x-lg"></i></button></div>`
            : ""
        }</div>`;
      })
      .join("");

    const participantCount = document.getElementById("participantCount");
    if (participantCount)
      participantCount.textContent = String(this.participants.length);
  }

  updateParticipantCallStatus(userId, inCall) {
    const p = this.participants.find((x) => x.id === userId);
    if (p) {
      p.inCall = inCall;
      this.updateParticipantsList();
    }
  }

  async updateRoomDisplay() {
    try {
      if (!this.currentRoomData) return;
      const nameEl = document.getElementById("roomNameDisplay");
      const pageTitleEl = document.getElementById("pageTitle");
      const titleDisplay = document.getElementById("roomTitleDisplay");
      const createdTime = document.getElementById("roomCreatedTime");
      const badge = document.getElementById("createdByBadge");
      const participantCount = document.getElementById("participantCount");
      const inviteInput = document.getElementById("inviteLink");

      if (nameEl) nameEl.textContent = this.currentRoomData.name || "";
      if (pageTitleEl)
        pageTitleEl.textContent = `${
          this.currentRoomData.name || ""
        } - StudyGroup`;
      if (titleDisplay)
        titleDisplay.textContent = this.currentRoomData.name || "";

      if (createdTime) {
        const created = this.currentRoomData.createdAt;
        let createdStr = "";
        if (created && typeof created.toDate === "function")
          createdStr = created.toDate().toUTCString();
        else if (created) createdStr = new Date(created).toUTCString();
        createdTime.textContent = createdStr
          ? `Created on ${createdStr} UTC`
          : "";
      }

      if (participantCount)
        participantCount.textContent = String(this.participants.length || 0);

      if (badge) {
        if (this.isOwner) {
          badge.textContent = "Created by You";
          badge.style.display = "inline-block";
        } else if (this.currentRoomData.creator) {
          try {
            const creatorInfo = await this.userAuth.getUserDisplayInfo(
              this.currentRoomData.creator
            );
            badge.textContent = `Created by ${
              creatorInfo.displayName || this.currentRoomData.creator
            }`;
            badge.style.display = "inline-block";
          } catch (e) {
            badge.textContent = `Created by ${
              this.currentRoomData.creator || ""
            }`;
            badge.style.display = "inline-block";
          }
        } else {
          badge.style.display = "none";
        }
      }

      if (inviteInput) {
        const baseUrl = window.location.origin + window.location.pathname;
        const roomId = this.currentRoomData._id || this.currentRoomData.id;
        inviteInput.value = `${baseUrl}?room=${encodeURIComponent(
          roomId
        )}&invite=true`;
      }
    } catch (err) {
      console.warn("updateRoomDisplay failed:", err);
    }
  }

  async saveRoomSettings() {
    if (!this.currentRoomData) {
      window.showToast?.("Room data not loaded", "error");
      return;
    }

    try {
      const roomNameInput = document.getElementById("roomNameInput");
      const roomDescInput = document.getElementById("roomDescInput");

      if (!roomNameInput) {
        throw new Error("Room name input not found");
      }

      const newName = roomNameInput.value.trim();
      const newDesc = roomDescInput ? roomDescInput.value.trim() : "";

      if (!newName) {
        window.showToast?.("Room name cannot be empty", "error");
        return;
      }

      const roomId = this.currentRoomData._id || this.currentRoomData.id;
      await fetchJsonWithAuth(`${window.__CONFIG__.apiBase}/${roomId}`, {
        method: "PUT",
        body: JSON.stringify({ name: newName, description: newDesc }),
        headers: { "Content-Type": "application/json" },
      });

      this.currentRoomData.name = newName;
      this.currentRoomData.description = newDesc;

      this.updateRoomDisplay();

      const modalEl = document.getElementById("settingsModal");
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }

      window.showToast?.("Room settings updated successfully", "success");
    } catch (err) {
      console.error("Error saving room settings:", err);
      const msg =
        (err && err.body && (err.body.error || err.body.message)) ||
        err.message ||
        "unknown error";
      window.showToast?.("Failed to save settings: " + msg, "error");
    }
  }

  async deleteRoom() {
    if (!this.isOwner) {
      window.showToast?.("Only the room owner can delete this room.", "error");
      return;
    }
    if (
      !confirm(
        "Are you sure you want to delete this room? This action cannot be undone and all messages will be lost."
      )
    )
      return;
    try {
      const roomId = this.currentRoomData._id || this.currentRoomData.id;

      await fetchJsonWithAuth(`${window.__CONFIG__.apiBase}/${roomId}`, {
        method: "DELETE",
      });

      window.showToast?.(
        "Room deleted successfully! Redirecting...",
        "success"
      );

      const modalEl = document.getElementById("settingsModal");
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }

      setTimeout(() => (window.location.href = "study-rooms.html"), 1200);
    } catch (err) {
      console.error("Error deleting room:", err);
      const msg = (err && err.message) || "unknown error";
      window.showToast?.("Could not delete room: " + msg, "error");
    }
  }

  async kickParticipant(userId) {
    if (!this.isOwner) {
      window.showToast?.(
        "Only the room owner can remove participants.",
        "error"
      );
      return;
    }

    if (
      !confirm(
        "Are you sure you want to remove this participant from the room?"
      )
    )
      return;

    try {
      const roomId = this.currentRoomData._id || this.currentRoomData.id;

      await fetchJsonWithAuth(
        `${
          window.__CONFIG__.apiBase
        }/${roomId}/participants/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
        }
      );

      this.participants = this.participants.filter((p) => p.id !== userId);
      this.updateParticipantsList();

      window.showToast?.("Participant removed successfully", "success");
    } catch (err) {
      console.error("Error removing participant:", err);
      window.showToast?.(
        "Could not remove participant: " + (err.message || "unknown error"),
        "error"
      );
    }
  }
}
