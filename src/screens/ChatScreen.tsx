import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  Animated,
  Dimensions,
  ActivityIndicator,
  Keyboard,
  Platform,
  Image,
  KeyboardAvoidingView, // Added KeyboardAvoidingView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../hooks';
import { useRoute, useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: Date;
  roomId: string;
  role?: 'user' | 'merchant' | 'mentor' | 'admin';
  level?: number;
  type?: 'join' | 'leave' | 'message';
  userRole?: 'user' | 'merchant' | 'mentor' | 'admin';
}

interface ChatTab {
  id: string;
  title: string;
  type: 'room' | 'private';
  messages: Message[];
  managedBy?: string;
  description?: string;
  moderators?: string[];
}

// API configuration
const getApiUrl = () => {
  return 'https://6f78a39c-dae9-42ae-bed4-1a98a4d51ca0-00-36d746w25elda.pike.replit.dev';
};

const API_BASE_URL = getApiUrl();

export default function ChatScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState(0);
  const [message, setMessage] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([]);
  const [showPopupMenu, setShowPopupMenu] = useState(false);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiList, setEmojiList] = useState<any[]>([]); // Changed to any[] to hold diverse emoji data
  const [showParticipantMenu, setShowParticipantMenu] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<any>(null);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isUserScrolling, setIsUserScrolling] = useState(false); // Track if user is manually scrolling
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [giftList, setGiftList] = useState<any[]>([]);
  const [activeGiftAnimation, setActiveGiftAnimation] = useState<any>(null);
  const [showUserGiftPicker, setShowUserGiftPicker] = useState(false);
  const [selectedGiftForUser, setSelectedGiftForUser] = useState<any>(null);
  const [giftAnimationDuration, setGiftAnimationDuration] = useState(5000); // Default 5 seconds
  const scrollViewRef = useRef<ScrollView>(null); // Ref for the main ScrollView containing tabs
  const flatListRefs = useRef<Record<string, FlatList<Message> | null>>({}); // Refs for each FlatList in tabs
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true); // State for auto-scroll toggle
  const giftVideoRef = useRef<Video>(null);
  const [showUserTagMenu, setShowUserTagMenu] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [filteredParticipants, setFilteredParticipants] = useState<any[]>([]);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const { user } = useAuth();

  // Get room data from navigation params
  const { roomId, roomName, roomDescription, autoFocusTab, type, targetUser } = route.params || {};

  // Function to join a specific room (called when navigating from RoomScreen)
  const joinSpecificRoom = async (roomId: string, roomName: string) => {
    try {
      console.log('Joining specific room/chat:', roomId, roomName, type);

      // Check if room is already in chatTabs
      const existingTabIndex = chatTabs.findIndex(tab => tab.id === roomId);
      if (existingTabIndex !== -1) {
        // Room already exists, just switch to it
        setActiveTab(existingTabIndex);
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: existingTabIndex * width,
            animated: true
          });
        }
        return;
      }

      // For private chats, don't try to load messages from room API
      let messages = [];
      if (type !== 'private') {
        // Load messages for the specific room
        try {
          const messagesResponse = await fetch(`${API_BASE_URL}/api/messages/${roomId}`, {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ChatMe-Mobile-App',
            },
          });
          messages = messagesResponse.ok ? await messagesResponse.json() : [];
        } catch (error) {
          console.log('No previous messages for room');
          messages = [];
        }
      } else {
        // For private chats, try to load private chat messages
        try {
          const messagesResponse = await fetch(`${API_BASE_URL}/api/chat/private/${roomId}/messages`, {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ChatMe-Mobile-App',
            },
          });
          messages = messagesResponse.ok ? await messagesResponse.json() : [];
        } catch (error) {
          console.log('No previous messages for private chat');
          messages = [];
        }
      }

      // Get room data to get correct managedBy info
        let roomData = null;
        if (type !== 'private') {
          try {
            const roomResponse = await fetch(`${API_BASE_URL}/api/rooms`, {
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ChatMe-Mobile-App',
              },
            });
            if (roomResponse.ok) {
              const rooms = await roomResponse.json();
              roomData = rooms.find((r: any) => r.id === roomId);
            }
          } catch (error) {
            console.log('Could not fetch room data');
          }
        }

        // Create new tab for the room or private chat
        const newTab: ChatTab = {
          id: roomId,
          title: roomName,
          type: type || 'room',
          messages: messages,
          managedBy: type === 'private' ? targetUser?.username : (roomData?.managedBy || roomData?.createdBy || 'admin'),
          description: roomDescription || (type === 'private' ? `Private chat with ${targetUser?.username}` : `${roomName} room`)
        };

      // Add the new tab
      setChatTabs(prevTabs => {
        const newTabs = [...prevTabs, newTab];
        // Only set active tab if this is the first tab or explicitly requested
        if (newTabs.length === 1) {
          setTimeout(() => {
            setActiveTab(0);
          }, 100);
        }
        return newTabs;
      });

      // Only add participant to room if it's not a private chat
      if (user?.username && type !== 'private') {
        await addParticipantToRoom(roomId, user.username, user?.role || 'user');
      }

      // Join room via socket (for both room and private chat)
      if (socket) {
        socket.emit('join-room', {
          roomId: roomId,
          username: user?.username || 'Guest',
          role: user?.role || 'user'
        });
      }

    } catch (error) {
      console.error('Error joining specific room:', error);
    }
  };

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(API_BASE_URL);
    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    // If navigated with specific room/chat ID, join it immediately
    if (roomId && roomName && socket) {
      console.log('Navigated to specific room/chat:', roomId, roomName, type);
      joinSpecificRoom(roomId, roomName);
    }
  }, [roomId, roomName, socket, type]);

  useEffect(() => {
    // If navigated from RoomScreen or ProfileScreen, focus on that specific room/chat
    // Only run this on initial load, not when chatTabs changes
    if (roomId && autoFocusTab && chatTabs.length > 0 && activeTab === 0) {
      const tabIndex = chatTabs.findIndex(tab => tab.id === roomId);
      if (tabIndex !== -1) {
        setActiveTab(tabIndex);
        // Scroll to the active tab
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: tabIndex * width,
            animated: true
          });
        }
      }
    }
  }, [roomId, autoFocusTab, chatTabs.length]);

  useEffect(() => {
    if (socket) {
      socket.on('new-message', (newMessage: Message) => {
        setChatTabs(prevTabs =>
          prevTabs.map(tab => {
            if (tab.id === newMessage.roomId) {
              // Replace optimistic message if it exists, otherwise add new message
              const existingIndex = tab.messages.findIndex(msg => 
                msg.id === newMessage.id || 
                (msg.sender === newMessage.sender && msg.content === newMessage.content && msg.id.startsWith('temp_'))
              );

              let updatedMessages;
              if (existingIndex !== -1) {
                // Replace optimistic message with real message
                updatedMessages = [...tab.messages];
                updatedMessages[existingIndex] = { ...newMessage };
              } else {
                // Check for duplicates by content and sender (avoid double messages)
                const isDuplicate = tab.messages.some(msg => 
                  msg.sender === newMessage.sender && 
                  msg.content === newMessage.content &&
                  Math.abs(new Date(msg.timestamp).getTime() - new Date(newMessage.timestamp).getTime()) < 2000
                );

                if (!isDuplicate) {
                  updatedMessages = [...tab.messages, newMessage];
                } else {
                  return tab; // Don't update if duplicate
                }
              }

              // Auto-scroll immediately for better UX
              if (autoScrollEnabled && !isUserScrolling && newMessage.roomId === chatTabs[activeTab]?.id) {
                setTimeout(() => {
                  flatListRefs.current[tab.id]?.scrollToEnd({ animated: true });
                }, 30);
              }

              return { ...tab, messages: updatedMessages };
            }
            return tab;
          })
        );

        // Track unread messages for other tabs
        const currentRoomId = chatTabs[activeTab]?.id;
        if (newMessage.roomId !== currentRoomId && newMessage.sender !== user?.username) {
          setUnreadCounts(prev => ({
            ...prev,
            [newMessage.roomId]: (prev[newMessage.roomId] || 0) + 1
          }));
        }
      });

      socket.on('user-joined', (joinMessage: Message) => {
        setChatTabs(prevTabs =>
          prevTabs.map(tab =>
            tab.id === joinMessage.roomId
              ? { ...tab, messages: [...tab.messages, joinMessage] }
              : tab
          )
        );
      });

      socket.on('user-left', (leaveMessage: Message) => {
        setChatTabs(prevTabs =>
          prevTabs.map(tab =>
            tab.id === leaveMessage.roomId
              ? { ...tab, messages: [...tab.messages, leaveMessage] }
              : tab
          )
        );
      });

      // Listen for participant updates
      socket.on('participants-updated', (updatedParticipants: any[]) => {
        console.log('Participants updated:', updatedParticipants.length);
        setParticipants(updatedParticipants);
      });

      // Listen for user kicked events
      socket.on('user-kicked', (data: any) => {
        if (data.kickedUser === user?.username) {
          Alert.alert('You have been kicked', `You were kicked from ${data.roomName} by ${data.kickedBy}`);
          // Remove the room tab
          setChatTabs(prevTabs => prevTabs.filter(tab => tab.id !== data.roomId));
        } else {
          // Update participant list
          setParticipants(prev => prev.filter(p => p.username !== data.kickedUser));
        }
      });

      // Listen for user muted events
      socket.on('user-muted', (data: any) => {
        if (data.mutedUser === user?.username) {
          if (data.action === 'mute') {
            setMutedUsers(prev => [...prev, data.mutedUser]);
            Alert.alert('You have been muted', `You were muted by ${data.mutedBy}`);
          } else {
            setMutedUsers(prev => prev.filter(username => username !== data.mutedUser));
            Alert.alert('You have been unmuted', `You were unmuted by ${data.mutedBy}`);
          }
        }
      });

      // Listen for gift animations
      socket.on('gift-animation', (data: any) => {
        // Don't show animation for gifts sent by current user (already shown locally)
        if (data.sender !== user?.username) {
          setActiveGiftAnimation({
            ...data.gift,
            sender: data.sender,
            timestamp: data.timestamp,
          });

          // Set animation duration based on gift type
          const duration = data.gift.type === 'animated' ? 6000 : 4000;
          setGiftAnimationDuration(duration);

          // Hide animation after duration
          setTimeout(() => {
            setActiveGiftAnimation(null);
          }, duration);
        }
      });

      return () => {
        socket.off('new-message');
        socket.off('user-joined');
        socket.off('user-left');
        socket.off('participants-updated');
        socket.off('user-kicked');
        socket.off('user-muted');
        socket.off('gift-animation');
      };
    }
  }, [socket, autoScrollEnabled, isUserScrolling]); // Include dependencies that affect auto-scroll

  const loadRooms = async () => {
    try {
      console.log('Loading rooms from:', `${API_BASE_URL}/api/rooms`);
      const response = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      console.log('Rooms response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseText = await response.text();
      console.log('Rooms response body:', responseText);

      const rooms = JSON.parse(responseText);

      // Don't automatically load all rooms - only load if specifically navigated from RoomScreen
      if (roomId && roomName) {
        // Only load the specific room that user wants to join
        const tabs: ChatTab[] = await Promise.all(
          rooms.filter((room: any) => room.id === roomId).map(async (room: any) => {
            try {
              const messagesResponse = await fetch(`${API_BASE_URL}/api/messages/${room.id}`, {
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': 'ChatMe-Mobile-App',
                },
              });
              const messages = messagesResponse.ok ? await messagesResponse.json() : [];

              return {
                id: room.id,
                title: room.name,
                type: room.type || 'room',
                messages: messages,
                managedBy: room.managedBy || room.createdBy || 'admin',
                description: room.description || `${room.name} room`
              };
            } catch (error) {
              console.error(`Error loading messages for room ${room.id}:`, error);
              return {
                id: room.id,
                title: room.name,
                type: room.type || 'room',
                messages: []
              };
            }
          })
        );

        setChatTabs(tabs);

        // Only join the specific room
        if (tabs.length > 0 && user?.username) {
          const room = tabs[0];
          await addParticipantToRoom(room.id, user.username, user.role || 'user');

          socket?.emit('join-room', {
            roomId: room.id,
            username: user?.username || 'Guest',
            role: user?.role || 'user'
          });
        }

        setActiveTab(0);
      } else {
        // If no specific room navigation, don't load any tabs
        setChatTabs([]);
      }
    } catch (error) {
      console.error('Error loading rooms:', error);
    }
  };

  const handleTabPress = (index: number) => {
    setActiveTab(index);

    // Scroll to the selected tab
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: index * width,
        animated: true
      });
    }

    // Clear unread count for the selected tab
    const selectedRoomId = chatTabs[index]?.id;
    if (selectedRoomId && unreadCounts[selectedRoomId]) {
      setUnreadCounts(prev => ({
        ...prev,
        [selectedRoomId]: 0
      }));
    }
  };

  const getRoleColor = (role?: string, username?: string, currentRoomId?: string) => {
    // Admin role takes highest precedence
    if (role === 'admin') return '#FF6B35'; // Orange Red for admin

    // Check if user is owner of current room
    const currentRoom = chatTabs.find(tab => tab.id === currentRoomId);
    const isOwner = currentRoom && currentRoom.managedBy === username;

    // Check if user is moderator of current room
    const isModerator = currentRoom && currentRoom.moderators && currentRoom.moderators.includes(username);

    if (isOwner) return '#e8d31a'; // Gold/Yellow for room owner
    if (isModerator) return '#e8d31a'; // Gold/Yellow for room moderator

    switch (role) {
      case 'user': return '#2196F3'; // Blue
      case 'merchant': return '#9C27B0'; // Purple
      case 'mentor': return '#FF5722'; // Deep Orange
      default: return '#2196F3'; // Default to blue
    }
  };

  const getRoleBackgroundColor = (role?: string, username?: string, currentRoomId?: string) => {
    // Admin role takes highest precedence
    if (role === 'admin') return '#FFEBEE'; // Light red background for admin

    // Check if user is owner of current room
    const currentRoom = chatTabs.find(tab => tab.id === currentRoomId);
    const isOwner = currentRoom && currentRoom.managedBy === username;

    // Check if user is moderator of current room
    const isModerator = currentRoom && currentRoom.moderators && currentRoom.moderators.includes(username);

    if (isOwner) return '#fefce8'; // Light yellow background for room owner
    if (isModerator) return '#fefce8'; // Light yellow background for room moderator

    switch (role) {
      case 'user': return '#E3F2FD'; // Light blue background
      case 'merchant': return '#F3E5F5'; // Light purple background
      case 'mentor': return '#FBE9E7'; // Light orange background
      default: return '#E3F2FD'; // Default light blue background
    }
  };

  const getRoleBadge = (role?: string, username?: string, currentRoomId?: string) => {
    // Remove all role badges
    return '';
  };

  const formatTime = (timestamp: Date) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const handleMessageChange = (text: string) => {
    setMessage(text);
    
    // Check for @ symbol to trigger user tagging
    const lastAtIndex = text.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const searchText = text.substring(lastAtIndex + 1);
      
      if (searchText.length === 0) {
        // Show all participants when @ is typed
        setFilteredParticipants(participants);
        setShowUserTagMenu(true);
        setTagSearchQuery('');
      } else if (searchText.length > 0 && !searchText.includes(' ')) {
        // Filter participants based on search
        const filtered = participants.filter(participant =>
          participant.username.toLowerCase().includes(searchText.toLowerCase())
        );
        setFilteredParticipants(filtered);
        setShowUserTagMenu(filtered.length > 0);
        setTagSearchQuery(searchText);
      } else {
        setShowUserTagMenu(false);
      }
    } else {
      setShowUserTagMenu(false);
    }
  };

  const handleUserTag = (username: string) => {
    const lastAtIndex = message.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const beforeAt = message.substring(0, lastAtIndex);
      const afterSearch = message.substring(lastAtIndex + 1 + tagSearchQuery.length);
      setMessage(`${beforeAt}@${username} ${afterSearch}`);
    }
    setShowUserTagMenu(false);
    setTagSearchQuery('');
  };

  const handleSendMessage = () => {
    // Check if user is muted (only for rooms, not private chats)
    if (chatTabs[activeTab]?.type !== 'private' && mutedUsers.includes(user?.username || '')) {
      Alert.alert('You are muted', 'You cannot send messages because you have been muted by an admin');
      return;
    }

    if (message.trim() && socket && user && chatTabs[activeTab]) {
      const currentRoomId = chatTabs[activeTab].id;
      const currentTab = chatTabs[activeTab];
      const isPrivateChat = currentTab.type === 'private';
      const messageContent = message.trim();

      // Create optimistic message object
      const optimisticMessage = {
        id: `temp_${Date.now()}_${user.username}`,
        sender: user.username,
        content: messageContent,
        timestamp: new Date(),
        roomId: currentRoomId,
        role: user.role || 'user',
        level: user.level || 1,
        type: 'message'
      };

      // Clear message immediately
      setMessage('');
      setShowUserTagMenu(false);

      // Add message optimistically to UI first (instant feedback)
      setChatTabs(prevTabs =>
        prevTabs.map(tab => 
          tab.id === currentRoomId
            ? { ...tab, messages: [...tab.messages, optimisticMessage] }
            : tab
        )
      );

      // Auto-scroll immediately
      setTimeout(() => {
        flatListRefs.current[currentRoomId]?.scrollToEnd({ animated: true });
      }, 50);

      // Then emit to server
      const messageData = {
        roomId: currentRoomId,
        sender: user.username,
        content: messageContent,
        role: user.role || 'user',
        level: user.level || 1,
        type: 'message',
        tempId: optimisticMessage.id // Include temp ID for replacement
      };

      socket.emit('sendMessage', messageData);
    }
  };

  const handleBackPress = () => {
    navigation.goBack();
  };

  const handleEllipsisPress = () => {
    setShowPopupMenu(true);
  };

  const handleLeaveRoom = () => {
    setShowPopupMenu(false);

    if (socket && chatTabs[activeTab] && user) {
      // Leave the room via socket
      socket.emit('leave-room', {
        roomId: chatTabs[activeTab].id,
        username: user.username || 'Guest',
        role: user.role || 'user'
      });

      const currentActiveTab = activeTab;

      // Remove the tab from chatTabs and clear messages
      setChatTabs(prevTabs => {
        const newTabs = prevTabs.filter((_, index) => index !== currentActiveTab);

        // Adjust active tab after removal
        if (newTabs.length === 0) {
          // If no more tabs, set activeTab to 0 but don't navigate back
          // This allows users to join new rooms
          setTimeout(() => setActiveTab(0), 100);
        } else {
          // Set new active tab
          const newActiveTab = currentActiveTab >= newTabs.length
            ? newTabs.length - 1
            : currentActiveTab;

          setTimeout(() => {
            setActiveTab(newActiveTab);
            scrollViewRef.current?.scrollTo({
              x: newActiveTab * width,
              animated: true
            });
          }, 100);
        }

        return newTabs;
      });
    }
  };

  const handleRoomInfo = () => {
    setShowPopupMenu(false);
    setShowRoomInfo(true);
  };

  const loadParticipants = async () => {
    try {
      if (chatTabs[activeTab]) {
        const response = await fetch(`${API_BASE_URL}/api/rooms/${chatTabs[activeTab].id}/participants`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ChatMe-Mobile-App',
          },
        });

        if (response.ok) {
          const participantData = await response.json();
          setParticipants(participantData);
          console.log('Participants loaded:', participantData.length);
        } else {
          console.error('Failed to load participants');
          setParticipants([]);
        }
      }
    } catch (error) {
      console.error('Error loading participants:', error);
      setParticipants([]);
    }
  };

  const addParticipantToRoom = async (roomId: string, username: string, role: string = 'user') => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
        body: JSON.stringify({ username, role }),
      });

      if (response.ok) {
        const participant = await response.json();
        console.log('Participant added to room:', participant);
        return participant;
      } else {
        console.error('Failed to add participant to room');
        return null;
      }
    } catch (error) {
      console.error('Error adding participant to room:', error);
      return null;
    }
  };

  const handleListPress = async () => {
    await loadParticipants();
    setShowParticipants(true);
  };

  const handleEmojiPress = () => {
    loadEmojis(); // Load emojis when the picker is opened
    setShowEmojiPicker(true);
  };

  const handleEmojiSelect = (selectedEmoji: any) => {
    if (selectedEmoji.type === 'image' && selectedEmoji.url) {
      // For image emojis from server, use the server URL
      if (typeof selectedEmoji.url === 'string' && selectedEmoji.url.startsWith('/')) {
        setMessage(prev => prev + `<img:${selectedEmoji.url}>`);
      } else if (typeof selectedEmoji.url === 'number') {
        // For local image emojis (require() returns a number), use a special format
        setMessage(prev => prev + `<localimg:${selectedEmoji.name}>`);
      } else {
        setMessage(prev => prev + `<img:${selectedEmoji.url}>`);
      }
    } else if (selectedEmoji.emoji) {
      // For text emojis, use the emoji character
      setMessage(prev => prev + selectedEmoji.emoji);
    } else {
      // Fallback to name if no emoji character available
      setMessage(prev => prev + selectedEmoji.name);
    }
    setShowEmojiPicker(false);
  };

  const handleParticipantPress = (participant: any) => {
    console.log('Participant pressed:', participant);
    setSelectedParticipant(participant);
    setShowParticipantMenu(true);
  };

  const handleViewProfile = () => {
    setShowParticipantMenu(false);
    setShowParticipants(false);
    // Navigate to profile screen
    navigation.navigate('Profile', { userId: selectedParticipant?.id || selectedParticipant?.username });
  };

  const handleOpenChat = async () => {
    setShowParticipantMenu(false);
    setShowParticipants(false);

    try {
      console.log('Creating private chat between:', user?.username, 'and', selectedParticipant?.username);

      // Create private chat via API
      const response = await fetch(`${API_BASE_URL}/api/chat/private`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
        body: JSON.stringify({
          participants: [user?.username, selectedParticipant?.username],
          initiatedBy: user?.username
        }),
      });

      console.log('Private chat response status:', response.status);

      if (response.ok) {
        const privateChat = await response.json();
        console.log(privateChat.isExisting ? 'Existing private chat found:' : 'Private chat created successfully:', privateChat.id);

        // Navigate to private chat (existing or new)
        navigation.navigate('Chat', {
          roomId: privateChat.id,
          roomName: `Chat with ${selectedParticipant?.username}`,
          roomDescription: `Private chat with ${selectedParticipant?.username}`,
          type: 'private',
          targetUser: selectedParticipant,
          autoFocusTab: true
        });
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Private chat creation failed:', errorData);
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to create private chat`);
      }
    } catch (error) {
      console.error('Error creating private chat:', error);
      Alert.alert('Error', error.message || 'Failed to create private chat');
    }
  };

  const handleKickUser = async () => {
    if (user?.role !== 'admin' && user?.role !== 'mentor') {
      Alert.alert('Error', 'Only admins and mentors can kick users');
      return;
    }

    setShowParticipantMenu(false);

    Alert.alert(
      'Kick User',
      `Are you sure you want to kick ${selectedParticipant?.username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Kick',
          style: 'destructive',
          onPress: async () => {
            try {
              // Remove from participants
              const roomId = chatTabs[activeTab]?.id;
              if (roomId && participants.some(p => p.username === selectedParticipant?.username)) {
                setParticipants(prev => prev.filter(p => p.username !== selectedParticipant?.username));

                // Emit kick event via socket
                socket?.emit('kick-user', {
                  roomId,
                  kickedUser: selectedParticipant?.username,
                  kickedBy: user?.username
                });

                Alert.alert('Success', `${selectedParticipant?.username} has been kicked from the room`);
              } else {
                Alert.alert('Error', 'User not found in the current room.');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to kick user');
            }
          }
        }
      ]
    );
  };

  const handleBlockUser = () => {
    setShowParticipantMenu(false);

    const isBlocked = blockedUsers.includes(selectedParticipant?.username);

    if (isBlocked) {
      setBlockedUsers(prev => prev.filter(username => username !== selectedParticipant?.username));
      Alert.alert('Success', `${selectedParticipant?.username} has been unblocked`);
    } else {
      setBlockedUsers(prev => [...prev, selectedParticipant?.username]);
      Alert.alert('Success', `${selectedParticipant?.username} has been blocked. You won't see their messages.`);
    }
  };

  const handleMuteUser = async () => {
    if (user?.role !== 'admin') {
      Alert.alert('Error', 'Only admins can mute users');
      return;
    }

    setShowParticipantMenu(false);

    const isMuted = mutedUsers.includes(selectedParticipant?.username);

    Alert.alert(
      isMuted ? 'Unmute User' : 'Mute User',
      `Are you sure you want to ${isMuted ? 'unmute' : 'mute'} ${selectedParticipant?.username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isMuted ? 'Unmute' : 'Mute',
          onPress: () => {
            if (isMuted) {
              setMutedUsers(prev => prev.filter(username => username !== selectedParticipant?.username));
              Alert.alert('Success', `${selectedParticipant?.username} has been unmuted`);
            } else {
              setMutedUsers(prev => [...prev, selectedParticipant?.username]);
              Alert.alert('Success', `${selectedParticipant?.username} has been muted`);
            }

            // Emit mute event via socket
            socket?.emit('mute-user', {
              roomId: chatTabs[activeTab]?.id,
              mutedUser: selectedParticipant?.username,
              mutedBy: user?.username,
              action: isMuted ? 'unmute' : 'mute'
            });
          }
        }
      ]
    );
  };

  const handleReportUser = () => {
    setShowParticipantMenu(false);

    Alert.alert(
      'Report User',
      'Please select a reason for reporting this user:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Spam',
          onPress: () => sendReport('spam')
        },
        {
          text: 'Harassment',
          onPress: () => sendReport('harassment')
        },
        {
          text: 'Inappropriate Content',
          onPress: () => sendReport('inappropriate')
        },
        {
          text: 'Other',
          onPress: () => sendReport('other')
        }
      ]
    );
  };

  const sendReport = (reason: string) => {
    try {
      const reportMessage = {
        roomId: 'admin_reports',
        sender: user?.username,
        content: `REPORT: User ${selectedParticipant?.username} reported for ${reason} by ${user?.username} in room ${chatTabs[activeTab]?.title}`,
        timestamp: new Date(),
        type: 'report'
      };

      // Send report to admin channel via socket
      socket?.emit('send-report', reportMessage);

      Alert.alert('Success', 'Report sent to administrators');
    } catch (error) {
      Alert.alert('Error', 'Failed to send report');
    }
  };

  // Map of local emoticon names to their require paths
  const localEmoticonsMap: { [key: string]: any } = {
    'Angry Old': require('../../assets/emoticon/angryold.png'),
    'Annoyed Old': require('../../assets/emoticon/annoyedold.png'),
    'Bum': require('../../assets/emoticon/bum.png'),
    'Call Me': require('../../assets/emoticon/callme.png'),
    'Cheeky Old': require('../../assets/emoticon/cheekyold.png'),
    'Confused': require('../../assets/emoticon/confused.png'),
    'Cool Old': require('../../assets/emoticon/coolold.png'),
    'Cry': require('../../assets/emoticon/cry.png'),
    'Curious Old': require('../../assets/emoticon/curiousold.png'),
    'Dies': require('../../assets/emoticon/dies.png'),
    'Disgust Old': require('../../assets/emoticon/disgustold.png'),
    'Dizzy': require('../../assets/emoticon/dizzy.png'),
    'Drooling': require('../../assets/emoticon/drooling.png'),
    'Err': require('../../assets/emoticon/err.png'),
    'Football': require('../../assets/emoticon/ffootball.png'),
    'Football Trophy': require('../../assets/emoticon/ffootballtrophy.png'),
    'Goal': require('../../assets/emoticon/fgoal.png'),
    'Goal Post': require('../../assets/emoticon/fgoalpost.png'),
    'Golden Boot': require('../../assets/emoticon/fgoldenboot.png'),
    'Hat': require('../../assets/emoticon/fhat.png'),
    'Flirt': require('../../assets/emoticon/flirt.png'),
    'Mint': require('../../assets/emoticon/fmint.png'),
    'Player': require('../../assets/emoticon/fplayer.png'),
    'Red Boot': require('../../assets/emoticon/fredboot.png'),
    'Red Card': require('../../assets/emoticon/fredcard.png'),
    'Red Jersey': require('../../assets/emoticon/fredjersey.png'),
    'Red Pants': require('../../assets/emoticon/fredpants.png'),
    'Referee': require('../../assets/emoticon/freferee.png'),
    'Ring': require('../../assets/emoticon/fring.png'),
    'Scarf': require('../../assets/emoticon/fscarf.png'),
    'Silver Ball': require('../../assets/emoticon/fsilverball.png'),
    'Soccer Toy': require('../../assets/emoticon/fsoccertoy.png'),
    'Socks': require('../../assets/emoticon/fsocks.png'),
    'Trophy': require('../../assets/emoticon/ftrophy.png'),
    'Whistle': require('../../assets/emoticon/fwhistle.png'),
    'Whistle 2': require('../../assets/emoticon/fwhistle2.png'),
    'Yellow Card': require('../../assets/emoticon/fyellowcard.png'),
    'Happy': require('../../assets/emoticon/happy.png'),
    'Hug Me': require('../../assets/emoticon/hugme.png'),
    'Hug Me 2': require('../../assets/emoticon/hugme2.png'),
    'Hypnotized': require('../../assets/emoticon/hypnotized.png'),
    'Insane': require('../../assets/emoticon/insane.png'),
    'Kiss Back': require('../../assets/emoticon/kissback.png'),
    'Kiss Lips': require('../../assets/emoticon/kisslips.png'),
    'Kiss Me': require('../../assets/emoticon/kissme.png'),
    'Kiss Old': require('../../assets/emoticon/kissold.png'),
    'Love': require('../../assets/emoticon/love.png'),
    'Nerd': require('../../assets/emoticon/nerd.png'),
    'Sad': require('../../assets/emoticon/sad.png'),
    'Shocked': require('../../assets/emoticon/shocked.png'),
    'Shy': require('../../assets/emoticon/shy.png'),
    'Shy Old': require('../../assets/emoticon/shyold.png'),
    'Silent': require('../../assets/emoticon/silent.png'),
    'Sleeping': require('../../assets/emoticon/sleeping.png'),
    'Sleepy': require('../../assets/emoticon/sleepy.png'),
    'Speechless': require('../../assets/emoticon/speechless.png'),
    'Sssh': require('../../assets/emoticon/sssh.png'),
    'Unimpressed': require('../../assets/emoticon/unimpressed.png'),
    'Very Happy': require('../../assets/emoticon/veryhappy.png'),
    'Wink': require('../../assets/emoticon/wink.png'),
    'Yuck': require('../../assets/emoticon/yuck.png'),
    'Yum': require('../../assets/emoticon/yum.png'),
  };

  const handleMessageLongPress = (message: Message) => {
    setSelectedMessage(message);
    setShowMessageMenu(true);
  };

  const handleCopyMessage = () => {
    if (selectedMessage) {
      // Copy message content to clipboard (React Native doesn't have navigator.clipboard)
      // We'll show an alert with the message content for now
      Alert.alert(
        'Message Copied',
        `Content: ${selectedMessage.content}\nFrom: ${selectedMessage.sender}\nTime: ${formatTime(selectedMessage.timestamp)}`,
        [
          {
            text: 'OK',
            onPress: () => {
              setShowMessageMenu(false);
              setSelectedMessage(null);
            }
          }
        ]
      );
    }
  };

  const renderMessageContent = (content: string) => {
    // Split content by @ mentions and style them
    const parts = content.split(/(@\w+)/g);
    
    return (
      <View style={styles.messageContentContainer}>
        <Text style={styles.messageContent} numberOfLines={0}>
          {parts.map((part, index) => {
            if (part.startsWith('@')) {
              // Style @ mentions
              return (
                <Text key={index} style={styles.mentionText}>
                  {part}
                </Text>
              );
            } else if (part.startsWith('<img:') && part.endsWith('>')) {
              // Extract server image URL
              const imageUrl = part.slice(5, -1);
              return (
                <Text key={index}>
                  <Image
                    source={{ uri: `${API_BASE_URL}${imageUrl}` }}
                    style={styles.inlineEmojiImage}
                    resizeMode="contain"
                  />
                </Text>
              );
            } else if (part.startsWith('<localimg:') && part.endsWith('>')) {
              // Extract local image name
              const imageName = part.slice(10, -1);
              const localImageSource = localEmoticonsMap[imageName];
              if (localImageSource) {
                return (
                  <Text key={index}>
                    <Image
                      source={localImageSource}
                      style={styles.inlineEmojiImage}
                      resizeMode="contain"
                    />
                  </Text>
                );
              }
            }
            return part;
          })}
        </Text>
      </View>
    );
  };

  const renderMessage = ({ item }: { item: Message }) => {
    // Filter out messages from blocked users
    if (blockedUsers.includes(item.sender)) {
      return null;
    }

    // Handle join/leave messages
    if (item.type === 'join' || item.type === 'leave') {
      const shouldShowBubble = item.userRole === 'mentor' || item.userRole === 'merchant';

      if (shouldShowBubble) {
        return (
          <View style={styles.joinLeaveContainer}>
            <View style={[
              styles.joinLeaveBubble,
              item.type === 'join' ? styles.joinBubble : styles.leaveBubble
            ]}>
              <Text style={styles.joinLeaveText}>
                {item.content}
              </Text>
              <Text style={styles.joinLeaveTime}>
                {formatTime(item.timestamp)}
              </Text>
            </View>
          </View>
        );
      } else {
        return (
          <View style={styles.systemMessageContainer}>
            <Text style={styles.systemMessageText}>
              {item.content}
            </Text>
            <Text style={styles.systemMessageTime}>
              {formatTime(item.timestamp)}
            </Text>
          </View>
        );
      }
    }

    // Handle gift messages
    if (item.type === 'gift') {
      return (
        <TouchableOpacity 
          style={styles.giftMessageContainer}
          onLongPress={() => handleMessageLongPress(item)}
        >
          <View style={styles.giftMessageBubble}>
            <View style={styles.giftMessageHeader}>
              <Text style={[styles.senderName, { color: getRoleColor(item.role, item.sender, chatTabs[activeTab]?.id) }]}>
                {item.sender}
              </Text>
              <Text style={styles.messageTime}>{formatTime(item.timestamp)}</Text>
            </View>
            <View style={styles.giftMessageContent}>
              <Ionicons name="gift" size={20} color="#FF69B4" />
              <View style={styles.giftMessageInline}>
                <Text style={styles.giftInlineText}>{item.content}</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    // Regular message
    return (
      <TouchableOpacity 
        style={styles.messageContainer}
        onLongPress={() => handleMessageLongPress(item)}
      >
        <View style={styles.messageHeaderRow}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>Lv.{item.level || 1}</Text>
          </View>
          <Text style={[
            styles.senderName,
            { color: getRoleColor(item.role, item.sender, chatTabs[activeTab]?.id) }
          ]}>
            {item.sender}:
          </Text>
          <View style={styles.messageContentInline}>
            {renderMessageContent(item.content)}
          </View>
          <Text style={styles.messageTime}>{formatTime(item.timestamp)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTabIndicator = () => {
    if (chatTabs.length <= 1) return null;

    return (
      <View style={styles.indicatorContainer}>
        {chatTabs.map((tab, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.indicator,
              index === activeTab && styles.activeIndicator,
              unreadCounts[tab.id] > 0 && index !== activeTab && styles.unreadIndicator
            ]}
            onPress={() => {
              setActiveTab(index);

              // Clear unread count for selected tab
              if (unreadCounts[tab.id]) {
                setUnreadCounts(prev => ({
                  ...prev,
                  [tab.id]: 0
                }));
              }
            }}
          />
        ))}
      </View>
    );
  };

  // Function to load emojis from the admin API and local assets
  const loadEmojis = async () => {
    try {
      // Local emoticons from assets/emoticon
      const localEmoticons = [
        { emoji: '😀', type: 'text', name: 'Grinning Face' },
        { emoji: '😂', type: 'text', name: 'Face with Tears of Joy' },
        { emoji: '🥰', type: 'text', name: 'Smiling Face with Hearts' },
        { emoji: '😊', type: 'text', name: 'Smiling Face with Smiling Eyes' },
        { emoji: '😍', type: 'text', name: 'Smiling Face with Heart-Eyes' },
        { emoji: '😘', type: 'text', name: 'Kiss' },
        { emoji: '😗', type: 'text', name: 'Kissing Face' },
        { emoji: '😙', type: 'text', name: 'Kissing Face with Smiling Eyes' },
        { emoji: '😚', type: 'text', name: 'Kissing Face with Closed Eyes' },
        { emoji: '🙂', type: 'text', name: 'Slightly Smiling Face' },
        { emoji: '🤗', type: 'text', name: 'Hugging Face' },
        { emoji: '🤩', type: 'text', name: 'Star-Struck' },
        { emoji: '🤔', type: 'text', name: 'Thinking Face' },
        { emoji: '🤨', type: 'text', name: 'Face with Raised Eyebrow' },
        { emoji: '😐', type: 'text', name: 'Neutral Face' },
        { emoji: '😑', type: 'text', name: 'Expressionless Face' },
        { emoji: '🙄', type: 'text', name: 'Face with Rolling Eyes' },
        { emoji: '😏', type: 'text', name: 'Smirking Face' },
        { emoji: '😣', type: 'text', name: 'Persevering Face' },
        { emoji: '😥', type: 'text', name: 'Sad but Relieved Face' },
        { emoji: '😮', type: 'text', name: 'Face with Open Mouth' },
        { emoji: '🤐', type: 'text', name: 'Zipper-Mouth Face' },
        { emoji: '😯', type: 'text', name: 'Hushed Face' },
        { emoji: '😪', type: 'text', name: 'Sleepy Face' },
        { emoji: '😫', type: 'text', name: 'Tired Face' },
        { emoji: '🥱', type: 'text', name: 'Yawning Face' },
        { emoji: '😴', type: 'text', name: 'Sleeping Face' },
        { emoji: '😌', type: 'text', name: 'Relieved Face' },
        { emoji: '😛', type: 'text', name: 'Face with Tongue' },
        { emoji: '😜', type: 'text', name: 'Winking Face with Tongue' },
        { emoji: '😝', type: 'text', name: 'Squinting Face with Tongue' },
        { emoji: '🤤', type: 'text', name: 'Drooling Face' },
        { emoji: '😒', type: 'text', name: 'Unamused Face' },
        { emoji: '😓', type: 'text', name: 'Downcast Face with Sweat' },
        { emoji: '😔', type: 'text', name: 'Pensive Face' },
        { emoji: '😕', type: 'text', name: 'Confused Face' },
        { emoji: '🙃', type: 'text', name: 'Upside-Down Face' },
        { emoji: '🤑', type: 'text', name: 'Money-Mouth Face' },
        { emoji: '😲', type: 'text', name: 'Astonished Face' },
        { emoji: '☹️', type: 'text', name: 'Frowning Face' },
        { emoji: '🙁', type: 'text', name: 'Slightly Frowning Face' },
        { emoji: '😖', type: 'text', name: 'Confounded Face' },
        { emoji: '😞', type: 'text', name: 'Disappointed Face' },
        { emoji: '😟', type: 'text', name: 'Worried Face' },
        { emoji: '😤', type: 'text', name: 'Face with Steam From Nose' },
        { emoji: '😢', type: 'text', name: 'Crying Face' },
        { emoji: '😭', type: 'text', name: 'Loudly Crying Face' },
        { emoji: '😦', type: 'text', name: 'Frowning Face with Open Mouth' },
        { emoji: '😧', type: 'text', name: 'Anguished Face' },
        { emoji: '😨', type: 'text', name: 'Fearful Face' },
        { emoji: '😩', type: 'text', name: 'Weary Face' },
        { emoji: '🤯', type: 'text', name: 'Exploding Head' },
        { emoji: '😬', type: 'text', name: 'Grimacing Face' },
        { emoji: '😰', type: 'text', name: 'Anxious Face with Sweat' },
        { emoji: '😱', type: 'text', name: 'Face Screaming in Fear' },
        { emoji: '🥵', type: 'text', name: 'Hot Face' },
        { emoji: '🥶', type: 'text', name: 'Cold Face' },
        { emoji: '😳', type: 'text', name: 'Flushed Face' },
        { emoji: '🤪', type: 'text', name: 'Zany Face' },
        { emoji: '😵', type: 'text', name: 'Dizzy Face' },
        { emoji: '🥴', type: 'text', name: 'Woozy Face' },
        { emoji: '😠', type: 'text', name: 'Angry Face' },
        { emoji: '😡', type: 'text', name: 'Pouting Face' },
        { emoji: '🤬', type: 'text', name: 'Face with Symbols on Mouth' },
        { emoji: '😷', type: 'text', name: 'Face with Medical Mask' },
        { emoji: '🤒', type: 'text', name: 'Face with Thermometer' },
        { emoji: '🤕', type: 'text', name: 'Face with Head-Bandage' },
        { emoji: '🤢', type: 'text', name: 'Nauseated Face' },
        { emoji: '🤮', type: 'text', name: 'Face Vomiting' },
        { emoji: '🤧', type: 'text', name: 'Sneezing Face' },
        { emoji: '😇', type: 'text', name: 'Smiling Face with Halo' },
        { emoji: '🤠', type: 'text', name: 'Cowboy Hat Face' },
        { emoji: '🥳', type: 'text', name: 'Partying Face' },
        { emoji: '🥺', type: 'text', name: 'Pleading Face' },
        { emoji: '🤡', type: 'text', name: 'Clown Face' },
        { emoji: '🤥', type: 'text', name: 'Lying Face' },
        { emoji: '🤫', type: 'text', name: 'Shushing Face' },
        { emoji: '🤭', type: 'text', name: 'Face with Hand Over Mouth' },
        { emoji: '😈', type: 'text', name: 'Smiling Face with Horns' },
        { emoji: '👿', type: 'text', name: 'Angry Face with Horns' },
        { emoji: '👹', type: 'text', name: 'Ogre' },
        { emoji: '👺', type: 'text', name: 'Goblin' },
        { emoji: '💀', type: 'text', name: 'Skull' },
        { emoji: '☠️', type: 'text', name: 'Skull and Crossbones' },
        { emoji: '👻', type: 'text', name: 'Ghost' },
        { emoji: '👽', type: 'text', name: 'Alien' },
        { emoji: '🤖', type: 'text', name: 'Robot' },
        // Add local emoticons from assets
        { url: require('../../assets/emoticon/angryold.png'), type: 'image', name: 'Angry Old' },
        { url: require('../../assets/emoticon/annoyedold.png'), type: 'image', name: 'Annoyed Old' },
        { url: require('../../assets/emoticon/bum.png'), type: 'image', name: 'Bum' },
        { url: require('../../assets/emoticon/callme.png'), type: 'image', name: 'Call Me' },
        { url: require('../../assets/emoticon/cheekyold.png'), type: 'image', name: 'Cheeky Old' },
        { url: require('../../assets/emoticon/confused.png'), type: 'image', name: 'Confused' },
        { url: require('../../assets/emoticon/coolold.png'), type: 'image', name: 'Cool Old' },
        { url: require('../../assets/emoticon/cry.png'), type: 'image', name: 'Cry' },
        { url: require('../../assets/emoticon/curiousold.png'), type: 'image', name: 'Curious Old' },
        { url: require('../../assets/emoticon/dies.png'), type: 'image', name: 'Dies' },
        { url: require('../../assets/emoticon/disgustold.png'), type: 'image', name: 'Disgust Old' },
        { url: require('../../assets/emoticon/dizzy.png'), type: 'image', name: 'Dizzy' },
        { url: require('../../assets/emoticon/drooling.png'), type: 'image', name: 'Drooling' },
        { url: require('../../assets/emoticon/err.png'), type: 'image', name: 'Err' },
        { url: require('../../assets/emoticon/ffootball.png'), type: 'image', name: 'Football' },
        { url: require('../../assets/emoticon/ffootballtrophy.png'), type: 'image', name: 'Football Trophy' },
        { url: require('../../assets/emoticon/fgoal.png'), type: 'image', name: 'Goal' },
        { url: require('../../assets/emoticon/fgoalpost.png'), type: 'image', name: 'Goal Post' },
        { url: require('../../assets/emoticon/fgoldenboot.png'), type: 'image', name: 'Golden Boot' },
        { url: require('../../assets/emoticon/fhat.png'), type: 'image', name: 'Hat' },
        { url: require('../../assets/emoticon/flirt.png'), type: 'image', name: 'Flirt' },
        { url: require('../../assets/emoticon/fmint.png'), type: 'image', name: 'Mint' },
        { url: require('../../assets/emoticon/fplayer.png'), type: 'image', name: 'Player' },
        { url: require('../../assets/emoticon/fredboot.png'), type: 'image', name: 'Red Boot' },
        { url: require('../../assets/emoticon/fredcard.png'), type: 'image', name: 'Red Card' },
        { url: require('../../assets/emoticon/fredjersey.png'), type: 'image', name: 'Red Jersey' },
        { url: require('../../assets/emoticon/fredpants.png'), type: 'image', name: 'Red Pants' },
        { url: require('../../assets/emoticon/freferee.png'), type: 'image', name: 'Referee' },
        { url: require('../../assets/emoticon/fring.png'), type: 'image', name: 'Ring' },
        { url: require('../../assets/emoticon/fscarf.png'), type: 'image', name: 'Scarf' },
        { url: require('../../assets/emoticon/fsilverball.png'), type: 'image', name: 'Silver Ball' },
        { url: require('../../assets/emoticon/fsoccertoy.png'), type: 'image', name: 'Soccer Toy' },
        { url: require('../../assets/emoticon/fsocks.png'), type: 'image', name: 'Socks' },
        { url: require('../../assets/emoticon/ftrophy.png'), type: 'image', name: 'Trophy' },
        { url: require('../../assets/emoticon/fwhistle.png'), type: 'image', name: 'Whistle' },
        { url: require('../../assets/emoticon/fwhistle2.png'), type: 'image', name: 'Whistle 2' },
        { url: require('../../assets/emoticon/fyellowcard.png'), type: 'image', name: 'Yellow Card' },
        { url: require('../../assets/emoticon/happy.png'), type: 'image', name: 'Happy' },
        { url: require('../../assets/emoticon/hugme.png'), type: 'image', name: 'Hug Me' },
        { url: require('../../assets/emoticon/hugme2.png'), type: 'image', name: 'Hug Me 2' },
        { url: require('../../assets/emoticon/hypnotized.png'), type: 'image', name: 'Hypnotized' },
        { url: require('../../assets/emoticon/insane.png'), type: 'image', name: 'Insane' },
        { url: require('../../assets/emoticon/kissback.png'), type: 'image', name: 'Kiss Back' },
        { url: require('../../assets/emoticon/kisslips.png'), type: 'image', name: 'Kiss Lips' },
        { url: require('../../assets/emoticon/kissme.png'), type: 'image', name: 'Kiss Me' },
        { url: require('../../assets/emoticon/kissold.png'), type: 'image', name: 'Kiss Old' },
        { url: require('../../assets/emoticon/love.png'), type: 'image', name: 'Love' },
        { url: require('../../assets/emoticon/nerd.png'), type: 'image', name: 'Nerd' },
        { url: require('../../assets/emoticon/sad.png'), type: 'image', name: 'Sad' },
        { url: require('../../assets/emoticon/shocked.png'), type: 'image', name: 'Shocked' },
        { url: require('../../assets/emoticon/shy.png'), type: 'image', name: 'Shy' },
        { url: require('../../assets/emoticon/shyold.png'), type: 'image', name: 'Shy Old' },
        { url: require('../../assets/emoticon/silent.png'), type: 'image', name: 'Silent' },
        { url: require('../../assets/emoticon/sleeping.png'), type: 'image', name: 'Sleeping' },
        { url: require('../../assets/emoticon/sleepy.png'), type: 'image', name: 'Sleepy' },
        { url: require('../../assets/emoticon/speechless.png'), type: 'image', name: 'Speechless' },
        { url: require('../../assets/emoticon/sssh.png'), type: 'image', name: 'Sssh' },
        { url: require('../../assets/emoticon/unimpressed.png'), type: 'image', name: 'Unimpressed' },
        { url: require('../../assets/emoticon/veryhappy.png'), type: 'image', name: 'Very Happy' },
        { url: require('../../assets/emoticon/wink.png'), type: 'image', name: 'Wink' },
        { url: require('../../assets/emoticon/yuck.png'), type: 'image', name: 'Yuck' },
        { url: require('../../assets/emoticon/yum.png'), type: 'image', name: 'Yum' },
      ];

      console.log('Loading emojis from:', `${API_BASE_URL}/api/emojis`);
      const response = await fetch(`${API_BASE_URL}/api/emojis`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      let serverEmojis = [];
      if (response.ok) {
        serverEmojis = await response.json();
        console.log('Server emojis loaded:', serverEmojis.length);
      } else {
        console.error('Failed to load server emojis');
      }

      // Combine local emoticons with server emojis
      const allEmojis = [...localEmoticons, ...serverEmojis];
      setEmojiList(allEmojis);
      console.log('Total emojis loaded:', allEmojis.length);
    } catch (error) {
      console.error('Error loading emojis:', error);
      // Fallback to just local emoticons if server fails
      const localEmoticons = [
        { emoji: '😀', type: 'text', name: 'Grinning Face' },
        { emoji: '😂', type: 'text', name: 'Face with Tears of Joy' },
        { emoji: '🥰', type: 'text', name: 'Smiling Face with Hearts' },
        { emoji: '😊', type: 'text', name: 'Smiling Face with Smiling Eyes' },
        { emoji: '😍', type: 'text', name: 'Smiling Face with Heart-Eyes' },
        // Add some local emoticons as fallback
        { url: require('../../assets/emoticon/happy.png'), type: 'image', name: 'Happy' },
        { url: require('../../assets/emoticon/sad.png'), type: 'image', name: 'Sad' },
        { url: require('../../assets/emoticon/wink.png'), type: 'image', name: 'Wink' },
        { url: require('../../assets/emoticon/love.png'), type: 'image', name: 'Love' },
        { url: require('../../assets/emoticon/cry.png'), type: 'image', name: 'Cry' },
      ];
      setEmojiList(localEmoticons);
    }
  };

  // Function to load gifts from the admin API
  const loadGifts = async () => {
    try {
      // Local gift assets
      const localGifts = [
        { 
          id: 'local_1', 
          name: 'Lion Animation', 
          icon: '🦁', 
          price: 150, 
          type: 'animated',
          animation: require('../../assets/gift/animated/Lion.gif'),
          category: 'animals'
        },
        { 
          id: 'local_2', 
          name: 'Lion Image', 
          icon: '🦁', 
          price: 100, 
          type: 'static',
          image: require('../../assets/gift/image/lion_img.gif'),
          category: 'animals'
        },
      ];

      console.log('Loading gifts from:', `${API_BASE_URL}/api/gifts`);
      const response = await fetch(`${API_BASE_URL}/api/gifts`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      let serverGifts = [];
      if (response.ok) {
        serverGifts = await response.json();
        console.log('Server gifts loaded:', serverGifts.length);
      } else {
        console.error('Failed to load server gifts');
        // Fallback to default gifts
        serverGifts = [
          { id: '1', name: 'Heart', icon: '❤️', price: 10, type: 'static' },
          { id: '2', name: 'Rose', icon: '🌹', price: 20, type: 'static' },
          { id: '3', name: 'Crown', icon: '👑', price: 50, type: 'static' },
          { id: '4', name: 'Diamond', icon: '💎', price: 100, type: 'static' },
          { id: '5', name: 'Rocket', icon: '🚀', price: 200, type: 'animated' },
        ];
      }

      // Combine local gifts with server gifts
      const allGifts = [...localGifts, ...serverGifts];
      setGiftList(allGifts);
      console.log('Total gifts loaded:', allGifts.length);
    } catch (error) {
      console.error('Error loading gifts:', error);
      // Fallback with local gifts and defaults
      const fallbackGifts = [
        { 
          id: 'local_1', 
          name: 'Lion Animation', 
          icon: '🦁', 
          price: 150, 
          type: 'animated',
          animation: require('../../assets/gift/animated/Lion.gif'),
          category: 'animals'
        },
        { 
          id: 'local_2', 
          name: 'Lion Image', 
          icon: '🦁', 
          price: 100, 
          type: 'static',
          image: require('../../assets/gift/image/lion_img.gif'),
          category: 'animals'
        },
        { id: '1', name: 'Heart', icon: '❤️', price: 10, type: 'static' },
        { id: '2', name: 'Rose', icon: '🌹', price: 20, type: 'static' },
        { id: '3', name: 'Crown', icon: '👑', price: 50, type: 'static' },
        { id: '4', name: 'Diamond', icon: '💎', price: 100, type: 'static' },
        { id: '5', name: 'Rocket', icon: '🚀', price: 200, type: 'animated' },
      ];
      setGiftList(fallbackGifts);
    }
  };

  // Function to send gift to room
  const handleGiftSend = async (gift: any) => {
    try {
      if (!user || !chatTabs[activeTab]) return;

      const currentRoomId = chatTabs[activeTab].id;
      const isPrivateChat = chatTabs[activeTab].type === 'private';

      // For private chats, gifts are sent via sendMessage with a special flag
      if (isPrivateChat) {
        if (socket) {
          socket.emit('sendMessage', currentRoomId, `🎁 Gift: ${gift.name} ${gift.icon}`, user.username, true);
        }
        // Add to local messages as a notification
        const notificationMessage: Message = {
          id: `gift_noti_${Date.now()}_${user.username}`,
          sender: 'System',
          content: `You sent ${gift.name} ${gift.icon} to ${targetUser?.username || 'the other participant'}`,
          timestamp: new Date(),
          roomId: currentRoomId,
          type: 'gift'
        };
        setChatTabs(prevTabs =>
          prevTabs.map(tab =>
            tab.id === currentRoomId
              ? { ...tab, messages: [...tab.messages, notificationMessage] }
              : tab
          )
        );
        setShowGiftPicker(false);
        Alert.alert('Gift Sent!', `You sent ${gift.name} ${gift.icon} for ${gift.price} credits`);
        return;
      }

      // Show gift animation immediately for public rooms
      setActiveGiftAnimation({
        ...gift,
        sender: user.username,
        timestamp: new Date(),
      });

      // Set animation duration based on gift type
      const duration = gift.type === 'animated' ? 6000 : 4000;
      setGiftAnimationDuration(duration);

      // Hide animation after duration
      setTimeout(() => {
        setActiveGiftAnimation(null);
      }, duration);

      // Send gift message via socket for public rooms
      if (socket) {
        const giftMessage = {
          roomId: currentRoomId,
          sender: user.username,
          content: `sent a ${gift.name} ${gift.icon}`,
          type: 'gift',
          gift: gift,
          timestamp: new Date(),
          role: user.role || 'user',
          level: user.level || 1
        };
        socket.emit('send-message', giftMessage);
      }

      // Add gift message to local state for public rooms
      const newMessage: Message = {
        id: `gift_${Date.now()}_${user.username}`,
        sender: user.username,
        content: `🎁 sent a ${gift.name} ${gift.icon}`,
        timestamp: new Date(),
        roomId: currentRoomId,
        role: user.role || 'user',
        level: user.level || 1,
        type: 'gift'
      };

      setChatTabs(prevTabs =>
        prevTabs.map(tab =>
          tab.id === currentRoomId
            ? { ...tab, messages: [...tab.messages, newMessage] }
            : tab
        )
      );

      setShowGiftPicker(false);
      Alert.alert('Gift Sent!', `You sent ${gift.name} ${gift.icon} for ${gift.price} credits`);

    } catch (error) {
      console.error('Error sending gift:', error);
      Alert.alert('Error', 'Failed to send gift');
    }
  };

  // Function to send gift to specific user
  const handleGiftSendToUser = (gift: any) => {
    setSelectedGiftForUser(gift);
    setShowGiftPicker(false);
    setShowUserGiftPicker(true);
  };

  // Function to send gift to selected user
  const sendGiftToUser = async (targetUser: any) => {
    try {
      if (!user || !selectedGiftForUser || !targetUser) return;

      // Show animation for sender
      setActiveGiftAnimation({
        ...selectedGiftForUser,
        sender: user.username,
        recipient: targetUser.username,
        timestamp: new Date(),
      });

      // Set animation duration based on gift type
      const duration = selectedGiftForUser.type === 'animated' ? 6000 : 4000;
      setGiftAnimationDuration(duration);

      setTimeout(() => {
        setActiveGiftAnimation(null);
      }, duration);

      // Send private gift notification to target user
      if (socket) {
        socket.emit('send-private-gift', {
          from: user.username,
          to: targetUser.username,
          gift: selectedGiftForUser,
          timestamp: new Date()
        });
      }

      // Add gift to local messages as a notification
      const giftMessage: Message = {
        id: `private_gift_${Date.now()}_${user.username}`,
        sender: 'System',
        content: `🎁 You sent ${selectedGiftForUser.name} ${selectedGiftForUser.icon} to ${targetUser.username}`,
        timestamp: new Date(),
        roomId: chatTabs[activeTab]?.id || 'system',
        role: 'system',
        level: 1,
        type: 'gift'
      };

      setChatTabs(prevTabs =>
        prevTabs.map(tab =>
          tab.id === chatTabs[activeTab]?.id
            ? { ...tab, messages: [...tab.messages, giftMessage] }
            : tab
        )
      );

      setShowUserGiftPicker(false);
      setSelectedGiftForUser(null);
      Alert.alert('Gift Sent!', `You sent ${selectedGiftForUser.name} ${selectedGiftForUser.icon} to ${targetUser.username} for ${selectedGiftForUser.price} credits`);

    } catch (error) {
      console.error('Error sending gift to user:', error);
      Alert.alert('Error', 'Failed to send gift to user');
    }
  };

  // Effect to load initial messages and participants when component mounts or roomId changes
  useEffect(() => {
    if (roomId) {
      loadParticipants();
    }
    loadEmojis(); // Load emojis when the component mounts or roomId changes
    loadGifts(); // Load gifts when the component mounts or roomId changes
  }, [roomId]);


  if (!chatTabs.length) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header with Gradient */}
        <LinearGradient
          colors={['#8B5CF6', '#3B82F6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerTextContainer}>
              <Text style={[styles.headerTitle, { color: '#fff' }]}>Chat</Text>
              <Text style={[styles.headerSubtitle, { color: '#e0f2f1' }]}>No active rooms</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Empty State */}
        <View style={styles.emptyStateContainer}>
          <Ionicons name="chatbubbles-outline" size={80} color="#ccc" />
          <Text style={styles.emptyStateTitle}>No Active Rooms</Text>
          <Text style={styles.emptyStateSubtitle}>Go back to join a room to start chatting</Text>
          <TouchableOpacity
            style={styles.joinRoomButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.joinRoomButtonText}>Browse Rooms</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Gradient */}
      <LinearGradient
        colors={chatTabs[activeTab]?.type === 'private' ? ['#FF9800', '#FF5722'] : ['#8B5CF6', '#3B82F6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          {chatTabs[activeTab]?.type === 'private' ? (
            // Private Chat Header with Avatar
            <View style={styles.privateChatHeaderContent}>
              <View style={styles.privateChatAvatar}>
                {targetUser?.avatar ? (
                  <Image source={{ uri: targetUser.avatar }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.defaultAvatarContainer}>
                    <Text style={styles.avatarInitial}>
                      {targetUser?.username ? targetUser.username.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.privateChatInfo}>
                <Text style={styles.privateChatName}>
                  {targetUser?.username || chatTabs[activeTab]?.title.replace('Chat with ', '')}
                </Text>
                <Text style={styles.privateChatStatus}>Online</Text>
              </View>
            </View>
          ) : (
            // Regular Room Header
            <View style={styles.headerTextContainer}>
              <Text style={[styles.headerTitle, { color: '#fff' }]}>{chatTabs[activeTab]?.title}</Text>
              <Text style={[styles.headerSubtitle, { color: '#e0f2f1' }]}>
                {chatTabs[activeTab]?.type === 'room' ? 'Chatroom' : 'Private Chat'}
              </Text>
            </View>
          )}

          <View style={styles.headerIcons}>
            {chatTabs[activeTab]?.type === 'private' ? (
              // Private Chat Icons
              <>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="videocam-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="call-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon} onPress={handleEllipsisPress}>
                  <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
                </TouchableOpacity>
              </>
            ) : (
              // Room Chat Icons
              <>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="calendar-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon}>
                  <Ionicons name="grid-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon} onPress={handleListPress}>
                  <Ionicons name="list-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerIcon} onPress={handleEllipsisPress}>
                  <Ionicons name="ellipsis-vertical" size={24} color="#fff" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
        {renderTabIndicator()}
      </LinearGradient>



      {/* Room Description - Only show for room chats, not private chats */}
      {chatTabs[activeTab] && chatTabs[activeTab].type !== 'private' && (
        <View style={styles.roomDescriptionContainer}>
          <Text style={styles.roomDescription}>
            <Text style={styles.roomNameHighlight}>{chatTabs[activeTab].title}</Text> - {chatTabs[activeTab].description || 'Welcome to the chatroom'}
          </Text>
          <Text style={styles.managedByText}>
            <Text style={styles.roomNameHighlight}>{chatTabs[activeTab].title}</Text> This room is managed by {chatTabs[activeTab]?.managedBy || 'admin'}
          </Text>
        </View>
      )}

      {/* Tab Navigation with KeyboardAvoidingView */}
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.tabContainer}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const newIndex = Math.round(event.nativeEvent.contentOffset.x / width);
              if (newIndex !== activeTab && newIndex >= 0 && newIndex < chatTabs.length) {
                setActiveTab(newIndex);

                // Clear unread count for the new active tab
                const selectedRoomId = chatTabs[newIndex]?.id;
                if (selectedRoomId && unreadCounts[selectedRoomId]) {
                  setUnreadCounts(prev => ({
                    ...prev,
                    [selectedRoomId]: 0
                  }));
                }
              }
            }}
            scrollEventThrottle={16}
          >
            {chatTabs.map((tab, index) => (
              <View key={tab.id} style={styles.tabContent}>
                <FlatList
                  ref={(ref) => { flatListRefs.current[tab.id] = ref; }} // Assign ref to the FlatList
                  data={tab.messages}
                  renderItem={renderMessage}
                  keyExtractor={(item) => item.id}
                  style={styles.messagesList}
                  contentContainerStyle={styles.messagesContainer}
                  scrollEnabled={true}
                  onScroll={({ nativeEvent }) => {
                    // Check if user is scrolling manually
                    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                    const isScrolledToBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 50; // Threshold for "at bottom"
                    setIsUserScrolling(!isScrolledToBottom);
                  }}
                  maintainVisibleContentPosition={{ minIndexForVisible: 0 }} // Optimization for FlatList
                />
              </View>
            ))}
          </ScrollView>
          {/* Auto Scroll Toggle Button */}
          <TouchableOpacity
            style={styles.autoScrollButton}
            onPress={() => setAutoScrollEnabled(!autoScrollEnabled)}
          >
            <Ionicons
              name={autoScrollEnabled ? "arrow-down-circle" : "arrow-down-circle-outline"}
              size={30}
              color="white"
            />
          </TouchableOpacity>
        </View>

        {/* Message Input */}
        <LinearGradient
          colors={['#8B5CF6', '#3B82F6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.inputContainer}
        >
          <View style={styles.inputWrapper}>
            <TouchableOpacity style={styles.emojiButton} onPress={handleEmojiPress}>
              <Ionicons name="happy-outline" size={24} color="#666" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.giftButton} onPress={() => {
              loadGifts();
              setShowGiftPicker(true);
            }}>
              <Ionicons name="gift-outline" size={24} color="#FF69B4" />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Type a message"
              placeholderTextColor="#999"
              value={message}
              onChangeText={handleMessageChange}
              multiline
              blurOnSubmit={false}
              returnKeyType="default"
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
              <Ionicons name="send" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </KeyboardAvoidingView>

      {/* Popup Menu Modal */}
      <Modal
        visible={showPopupMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPopupMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPopupMenu(false)}
        >
          <View style={styles.popupMenu}>
            {chatTabs[activeTab]?.type === 'private' ? (
              // Private Chat Menu Options
              <>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowPopupMenu(false);
                    navigation.navigate('Profile', { userId: targetUser?.id || targetUser?.username });
                  }}
                >
                  <Ionicons name="person-outline" size={20} color="#333" />
                  <Text style={styles.menuText}>View Profile</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowPopupMenu(false);
                    Alert.alert('Search Messages', 'Search functionality will be added soon');
                  }}
                >
                  <Ionicons name="search-outline" size={20} color="#333" />
                  <Text style={styles.menuText}>Search Messages</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowPopupMenu(false);
                    Alert.alert('Clear Chat', 'Clear chat functionality will be added soon');
                  }}
                >
                  <Ionicons name="trash-outline" size={20} color="#FF9800" />
                  <Text style={[styles.menuText, { color: '#FF9800' }]}>Clear Chat</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.menuItem, styles.lastMenuItem]}
                  onPress={handleLeaveRoom}
                >
                  <Ionicons name="exit-outline" size={20} color="#F44336" />
                  <Text style={[styles.menuText, { color: '#F44336' }]}>Close Chat</Text>
                </TouchableOpacity>
              </>
            ) : (
              // Room Chat Menu Options
              <>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleLeaveRoom}
                >
                  <Ionicons name="exit-outline" size={20} color="#F44336" />
                  <Text style={[styles.menuText, { color: '#F44336' }]}>Leave Room</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.menuItem, styles.lastMenuItem]}
                  onPress={handleRoomInfo}
                >
                  <Ionicons name="information-circle-outline" size={20} color="#333" />
                  <Text style={styles.menuText}>Info Room</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Room Info Modal */}
      <Modal
        visible={showRoomInfo}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRoomInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.roomInfoModal}>
            <View style={styles.roomInfoHeader}>
              <Text style={styles.roomInfoTitle}>Room Information</Text>
              <TouchableOpacity onPress={() => setShowRoomInfo(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.roomInfoContent}>
              <View style={styles.roomInfoItem}>
                <Ionicons name="home-outline" size={20} color="#666" />
                <View style={styles.roomInfoText}>
                  <Text style={styles.roomInfoLabel}>Room Name</Text>
                  <Text style={styles.roomInfoValue}>{chatTabs[activeTab]?.title}</Text>
                </View>
              </View>

              <View style={styles.roomInfoItem}>
                <Ionicons name="calendar-outline" size={20} color="#666" />
                <View style={styles.roomInfoText}>
                  <Text style={styles.roomInfoLabel}>Created Date</Text>
                  <Text style={styles.roomInfoValue}>18 August 2025</Text>
                </View>
              </View>

              <View style={styles.roomInfoItem}>
                <Ionicons name="person-outline" size={20} color="#666" />
                <View style={styles.roomInfoText}>
                  <Text style={styles.roomInfoLabel}>Owner</Text>
                  <Text style={styles.roomInfoValue}>{chatTabs[activeTab]?.managedBy || 'admin'}</Text>
                </View>
              </View>

              <View style={styles.roomInfoItem}>
                <Ionicons name="shield-outline" size={20} color="#666" />
                <View style={styles.roomInfoText}>
                  <Text style={styles.roomInfoLabel}>Moderator</Text>
                  <Text style={styles.roomInfoValue}>{chatTabs[activeTab]?.managedBy || 'admin'}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Participants List Modal */}
      <Modal
        visible={showParticipants}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowParticipants(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.participantsModal}>
            <View style={styles.participantsHeader}>
              <Text style={styles.participantsTitle}>Room Participants</Text>
              <TouchableOpacity onPress={() => setShowParticipants(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.participantsList}>
              {participants.length > 0 ? (
                participants.map((participant, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.participantItem,
                      { backgroundColor: getRoleBackgroundColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                    ]}
                    onPress={() => handleParticipantPress(participant)}
                  >
                    <View style={[
                      styles.participantAvatar,
                      { backgroundColor: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                    ]}>
                      <Text style={styles.participantAvatarText}>
                        {participant.username ? participant.username.charAt(0).toUpperCase() : 'U'}
                      </Text>
                    </View>
                    <View style={styles.participantInfo}>
                      <Text style={[
                        styles.participantName,
                        { color: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                      ]}>
                        {participant.username || 'Unknown User'}
                      </Text>
                      <View style={styles.participantRoleContainer}>
                        <Text style={[
                          styles.participantRole,
                          { color: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                        ]}>
                          {(() => {
                            const currentRoom = chatTabs[activeTab];
                            const isOwner = currentRoom && currentRoom.managedBy === participant.username;
                            const isModerator = currentRoom && currentRoom.moderators && currentRoom.moderators.includes(participant.username);

                            if (isOwner) return '👤 Owner';
                            if (isModerator) return '🛡️ Moderator';

                            switch (participant.role) {
                              case 'admin': return '👑 Admin';
                              case 'merchant': return '🏪 Merchant';
                              case 'mentor': return '🎓 Mentor';
                              default: return '👤 User';
                            }
                          })()}
                        </Text>
                        {mutedUsers.includes(participant.username) && (
                          <Text style={styles.mutedIndicator}>🔇 Muted</Text>
                        )}
                        {blockedUsers.includes(participant.username) && (
                          <Text style={styles.blockedIndicator}>🚫 Blocked</Text>
                        )}
                      </View>
                    </View>
                    <View style={[
                      styles.participantStatus,
                      { backgroundColor: participant.isOnline ? '#4CAF50' : '#9E9E9E' }
                    ]}>
                      <Text style={styles.participantStatusText}>
                        {participant.isOnline ? 'Online' : 'Offline'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.noParticipants}>
                  <Text style={styles.noParticipantsText}>No participants found</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Participant Context Menu Modal */}
      <Modal
        visible={showParticipantMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowParticipantMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowParticipantMenu(false)}
        >
          <View style={styles.participantContextMenu}>
            <View style={styles.participantMenuHeader}>
              <View style={styles.participantMenuAvatar}>
                <Text style={styles.participantMenuAvatarText}>
                  {selectedParticipant?.username ? selectedParticipant.username.charAt(0).toUpperCase() : 'U'}
                </Text>
              </View>
              <Text style={styles.participantMenuName}>{selectedParticipant?.username}</Text>
            </View>

            <TouchableOpacity
              style={styles.participantMenuItem}
              onPress={handleViewProfile}
            >
              <Ionicons name="person-outline" size={20} color="#333" />
              <Text style={styles.participantMenuText}>View Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.participantMenuItem}
              onPress={handleOpenChat}
            >
              <Ionicons name="chatbubble-outline" size={20} color="#333" />
              <Text style={styles.participantMenuText}>Private Chat</Text>
            </TouchableOpacity>

            {(user?.role === 'admin' || user?.role === 'mentor') && (
              <TouchableOpacity
                style={styles.participantMenuItem}
                onPress={handleKickUser}
              >
                <Ionicons name="exit-outline" size={20} color="#F44336" />
                <Text style={[styles.participantMenuText, { color: '#F44336' }]}>Kick User</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.participantMenuItem}
              onPress={handleBlockUser}
            >
              <Ionicons name="ban-outline" size={20} color="#FF9800" />
              <Text style={[styles.participantMenuText, { color: '#FF9800' }]}>
                {blockedUsers.includes(selectedParticipant?.username) ? 'Unblock User' : 'Block User'}
              </Text>
            </TouchableOpacity>

            {user?.role === 'admin' && (
              <TouchableOpacity
                style={styles.participantMenuItem}
                onPress={handleMuteUser}
              >
                <Ionicons name="volume-mute-outline" size={20} color="#9C27B0" />
                <Text style={[styles.participantMenuText, { color: '#9C27B0' }]}>
                  {mutedUsers.includes(selectedParticipant?.username) ? 'Unmute User' : 'Mute User'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.participantMenuItem, styles.lastParticipantMenuItem]}
              onPress={handleReportUser}
            >
              <Ionicons name="flag-outline" size={20} color="#F44336" />
              <Text style={[styles.participantMenuText, { color: '#F44336' }]}>Report User</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Emoji Picker Modal */}
      <Modal
        visible={showEmojiPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowEmojiPicker(false)}
      >
        <TouchableOpacity
          style={styles.emojiModalOverlay}
          activeOpacity={1}
          onPress={() => setShowEmojiPicker(false)}
        >
          <View style={styles.emojiPickerContainer}>
            <View style={styles.emojiPickerModal}>
              <View style={styles.emojiPickerHeader}>
                <Text style={styles.emojiPickerTitle}>Select Emoji ✕</Text>
              </View>

              <View style={styles.emojiPickerContent}>
                {emojiList.length > 0 ? (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    style={styles.emojiScrollView}
                    contentContainerStyle={styles.emojiScrollContent}
                  >
                    {emojiList.map((emoji, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.emojiItem}
                        onPress={() => handleEmojiSelect(emoji)}
                      >
                        {emoji.type === 'text' ? (
                          <Text style={styles.emojiText}>{emoji.emoji}</Text>
                        ) : emoji.type === 'image' && typeof emoji.url === 'string' ? (
                          <Image source={{ uri: `${API_BASE_URL}${emoji.url}` }} style={styles.emojiImage} />
                        ) : emoji.type === 'image' && typeof emoji.url === 'number' ? (
                          <Image source={emoji.url} style={styles.emojiImage} />
                        ) : (
                          <Text style={styles.emojiText}>🙂</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.emptyEmojiContainer}>
                    <Ionicons name="cloud-upload-outline" size={40} color="#ccc" />
                    <Text style={styles.emptyEmojiTitle}>No Emojis Available</Text>
                    <Text style={styles.emptyEmojiSubtitle}>
                      Add emojis via the Admin Panel to make them available here.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Gift Picker Modal */}
      <Modal
        visible={showGiftPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowGiftPicker(false)}
      >
        <View style={styles.giftModalOverlay}>
          <View style={styles.giftPickerModal}>
            <View style={styles.giftPickerHeader}>
              <Text style={styles.giftPickerTitle}>Send Gift 🎁</Text>
              <TouchableOpacity onPress={() => setShowGiftPicker(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.giftPickerContent} showsVerticalScrollIndicator={false}>
              <View style={styles.giftGrid}>
                {giftList.map((gift) => (
                  <View key={gift.id} style={styles.giftItemContainer}>
                    <TouchableOpacity
                      style={styles.giftItem}
                      onPress={() => handleGiftSend(gift)}
                    >
                    <View style={styles.giftIconContainer}>
                      {gift.image ? (
                        <Image 
                          source={typeof gift.image === 'string' ? { uri: gift.image } : gift.image} 
                          style={styles.giftPreviewImage} 
                          resizeMode="contain"
                        />
                      ) : gift.animation ? (
                        <Image 
                          source={typeof gift.animation === 'string' ? { uri: gift.animation } : gift.animation} 
                          style={styles.giftPreviewImage} 
                          resizeMode="contain"
                        />
                      ) : (
                        <Text style={styles.giftIcon}>{gift.icon}</Text>
                      )}
                      {gift.type === 'animated' && (
                        <View style={styles.animatedBadge}>
                          <Text style={styles.animatedBadgeText}>✨</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.giftName}>{gift.name}</Text>
                    <View style={styles.giftPriceContainer}>
                      <Ionicons name="diamond-outline" size={12} color="#FFD700" />
                      <Text style={styles.giftPrice}>{gift.price}</Text>
                    </View>
                    </TouchableOpacity>
                    <View style={styles.giftActionButtons}>
                      <TouchableOpacity
                        style={styles.sendToRoomButton}
                        onPress={() => handleGiftSend(gift)}
                      >
                        <Text style={styles.giftActionText}>Room</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sendToUserButton}
                        onPress={() => handleGiftSendToUser(gift)}
                      >
                        <Text style={styles.giftActionText}>User</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* User Gift Picker Modal */}
      <Modal
        visible={showUserGiftPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowUserGiftPicker(false)}
      >
        <View style={styles.giftModalOverlay}>
          <View style={styles.userGiftPickerModal}>
            <View style={styles.giftPickerHeader}>
              <Text style={styles.giftPickerTitle}>
                Send {selectedGiftForUser?.name} {selectedGiftForUser?.icon} to User
              </Text>
              <TouchableOpacity onPress={() => setShowUserGiftPicker(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.userListContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>Select User:</Text>
              {participants.map((participant, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.userGiftItem}
                  onPress={() => sendGiftToUser(participant)}
                  disabled={participant.username === user?.username}
                >
                  <View style={[
                    styles.participantAvatar,
                    { backgroundColor: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                  ]}>
                    <Text style={styles.participantAvatarText}>
                      {participant.username ? participant.username.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                  <View style={styles.userGiftInfo}>
                    <Text style={[
                      styles.userGiftName,
                      { color: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                    ]}>
                      {participant.username || 'Unknown User'}
                    </Text>
                    <Text style={styles.userGiftRole}>
                      {(() => {
                        const currentRoom = chatTabs[activeTab];
                        const isOwner = currentRoom && currentRoom.managedBy === participant.username;

                        if (isOwner) return '👤 Owner';

                        switch (participant.role) {
                          case 'admin': return '👑 Admin';
                          case 'merchant': return '🏪 Merchant';
                          case 'mentor': return '🎓 Mentor';
                          default: return '👤 User';
                        }
                      })()}
                    </Text>
                  </View>
                  {participant.username === user?.username && (
                    <Text style={styles.selfLabel}>(You)</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* User Tag Menu Modal */}
      <Modal
        visible={showUserTagMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowUserTagMenu(false)}
      >
        <TouchableOpacity
          style={styles.userTagModalOverlay}
          activeOpacity={1}
          onPress={() => setShowUserTagMenu(false)}
        >
          <View style={styles.userTagMenu}>
            <View style={styles.userTagHeader}>
              <Text style={styles.userTagTitle}>Select User to Tag</Text>
            </View>
            <ScrollView style={styles.userTagList} showsVerticalScrollIndicator={false}>
              {filteredParticipants.map((participant, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.userTagItem}
                  onPress={() => handleUserTag(participant.username)}
                >
                  <View style={[
                    styles.participantAvatar,
                    { backgroundColor: getRoleColor(participant.role, participant.username, chatTabs[activeTab]?.id) }
                  ]}>
                    <Text style={styles.participantAvatarText}>
                      {participant.username ? participant.username.charAt(0).toUpperCase() : 'U'}
                    </Text>
                  </View>
                  <View style={styles.userTagInfo}>
                    <Text style={styles.userTagName}>@{participant.username}</Text>
                    <Text style={styles.userTagRole}>
                      {(() => {
                        const currentRoom = chatTabs[activeTab];
                        const isOwner = currentRoom && currentRoom.managedBy === participant.username;

                        if (isOwner) return '👤 Owner';

                        switch (participant.role) {
                          case 'admin': return '👑 Admin';
                          case 'merchant': return '🏪 Merchant';
                          case 'mentor': return '🎓 Mentor';
                          default: return '👤 User';
                        }
                      })()}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message Copy Menu Modal */}
      <Modal
        visible={showMessageMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowMessageMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMessageMenu(false)}
        >
          <View style={styles.messageContextMenu}>
            <View style={styles.messageMenuHeader}>
              <Text style={styles.messageMenuTitle}>Message Options</Text>
            </View>
            
            <TouchableOpacity
              style={styles.messageMenuItem}
              onPress={handleCopyMessage}
            >
              <Ionicons name="copy-outline" size={20} color="#333" />
              <Text style={styles.messageMenuText}>Copy Message</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.messageMenuItem}
              onPress={() => {
                if (selectedMessage) {
                  setMessage(`@${selectedMessage.sender} `);
                }
                setShowMessageMenu(false);
                setSelectedMessage(null);
              }}
            >
              <Ionicons name="at-outline" size={20} color="#333" />
              <Text style={styles.messageMenuText}>Reply to User</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.messageMenuItem, styles.lastMessageMenuItem]}
              onPress={() => {
                setShowMessageMenu(false);
                setSelectedMessage(null);
              }}
            >
              <Ionicons name="close-outline" size={20} color="#666" />
              <Text style={[styles.messageMenuText, { color: '#666' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Gift Animation Overlay - Modal Style */}
      {activeGiftAnimation && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setActiveGiftAnimation(null)}
        >
          <View style={styles.giftAnimationOverlay}>
            <View style={styles.giftAnimationModal}>
              <TouchableOpacity 
                style={styles.closeGiftButton}
                onPress={() => setActiveGiftAnimation(null)}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
              
              <View style={styles.giftAnimationContent}>
                <View style={styles.giftAnimationMediaContainer}>
                  {activeGiftAnimation.animation ? (
                    // For animated GIFs or video files
                    typeof activeGiftAnimation.animation === 'string' && 
                    (activeGiftAnimation.animation.includes('.mp4') || activeGiftAnimation.animation.includes('.webm')) ? (
                      <Video
                        ref={giftVideoRef}
                        source={{ uri: activeGiftAnimation.animation }}
                        style={styles.giftAnimationVideo}
                        shouldPlay={true}
                        isLooping={false}
                        resizeMode="contain"
                        onPlaybackStatusUpdate={(status) => {
                          if (status.isLoaded && status.didJustFinish) {
                            setTimeout(() => {
                              setActiveGiftAnimation(null);
                            }, 500);
                          }
                        }}
                      />
                    ) : (
                      // For GIF files
                      <Image 
                        source={typeof activeGiftAnimation.animation === 'string' ? { uri: activeGiftAnimation.animation } : activeGiftAnimation.animation} 
                        style={styles.giftAnimationImage}
                        resizeMode="contain"
                      />
                    )
                  ) : activeGiftAnimation.image ? (
                    <Image 
                      source={typeof activeGiftAnimation.image === 'string' ? { uri: activeGiftAnimation.image } : activeGiftAnimation.image} 
                      style={styles.giftAnimationImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={styles.giftAnimationIcon}>{activeGiftAnimation.icon}</Text>
                  )}
                </View>
                
                <View style={styles.giftAnimationInfo}>
                  <Text style={styles.giftAnimationSender}>
                    {activeGiftAnimation.sender}
                  </Text>
                  <Text style={styles.giftAnimationText}>
                    sent {activeGiftAnimation.name} {activeGiftAnimation.icon}
                    {activeGiftAnimation.recipient && ` to ${activeGiftAnimation.recipient}`}
                  </Text>
                  <View style={styles.giftAnimationPrice}>
                    <Ionicons name="diamond" size={16} color="#FFD700" />
                    <Text style={styles.giftPriceText}>{activeGiftAnimation.price}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  chatContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
  privateChatHistory: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  privateChatSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  emptyPrivateChats: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyPrivateChatsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 15,
  },
  emptyPrivateChatsSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 5,
    textAlign: 'center',
  },
  actionSection: {
    padding: 20,
    paddingTop: 0,
  },
  header: {
    paddingTop: 10,
    paddingBottom: 15,
    paddingHorizontal: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  headerTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  privateChatHeaderContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  privateChatAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  defaultAvatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  privateChatInfo: {
    flex: 1,
  },
  privateChatName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  privateChatStatus: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    padding: 8,
    marginLeft: 4,
  },
  indicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(51, 51, 51, 0.4)',
    marginHorizontal: 4,
  },
  activeIndicator: {
    backgroundColor: '#229c93',
  },
  unreadIndicator: {
    backgroundColor: '#FF6B35',
  },
  tabNavigation: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    maxHeight: 50,
  },
  tabNavigationContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  tabNavItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
  },
  activeTabNavItem: {
    backgroundColor: '#229c93',
  },
  tabNavText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  activeTabNavText: {
    color: '#fff',
  },
  roomDescriptionContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  roomDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  managedByText: {
    fontSize: 13,
    color: '#888',
  },
  roomNameHighlight: {
    color: '#d6510f',
    fontWeight: 'bold',
  },
  tabContainer: {
    flex: 1,
  },
  tabContent: {
    width: width,
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  messageContainer: {
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  messageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  messageBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  levelBadge: {
    backgroundColor: '#229c93',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 3,
    minWidth: 30,
    alignItems: 'center',
  },
  levelText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: 'white',
  },
  roleBadge: {
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginRight: 4,
    minWidth: 20,
    alignItems: 'center',
  },
  roleBadgeText: {
    fontSize: 12,
    color: 'white',
  },
  senderName: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 6,
  },
  messageTime: {
    fontSize: 11,
    color: '#999',
    marginLeft: 6,
    alignSelf: 'flex-start',
  },
  messageContentContainer: {
    marginTop: 0,
    paddingLeft: 0,
    width: '100%',
  },
  messageContentInline: {
    flex: 1,
    marginRight: 6,
    minWidth: 0,
  },
  messageContent: {
    fontSize: 14,
    color: '#333',
    lineHeight: 18,
    textAlign: 'left',
    flexWrap: 'wrap',
  },
  inlineEmojiImage: {
    width: 18,
    height: 18,
    resizeMode: 'contain',
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  emojiButton: {
    marginRight: 8,
  },
  giftButton: {
    marginRight: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#229c93',
    borderRadius: 20,
    padding: 8,
    marginLeft: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupMenu: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 8,
    marginHorizontal: 20,
    minWidth: 180,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  lastMenuItem: {
    borderBottomWidth: 0,
  },
  menuText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    fontWeight: '500',
  },
  roomInfoModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    marginHorizontal: 20,
    maxHeight: '80%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  roomInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  roomInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  roomInfoContent: {
    padding: 20,
  },
  roomInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  roomInfoText: {
    marginLeft: 12,
    flex: 1,
  },
  roomInfoLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  roomInfoValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  participantsModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    marginHorizontal: 20,
    maxHeight: '80%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  participantsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  participantsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  participantsList: {
    maxHeight: 400,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  participantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#229c93',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  participantAvatarText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  participantRole: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  participantStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  participantStatusText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  noParticipants: {
    padding: 40,
    alignItems: 'center',
  },
  noParticipantsText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  // Emoji Picker Styles
  emojiModalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  emojiPickerContainer: {
    paddingHorizontal: 16,
    paddingBottom: 100, // Position above input area
  },
  emojiPickerModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  emojiPickerHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    alignItems: 'center',
  },
  emojiPickerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  emojiPickerContent: {
    maxHeight: 200, // Increased height for vertical scrolling
    minHeight: 140,
  },
  emojiScrollView: {
    flex: 1,
  },
  emojiScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emojiItem: {
    width: 40,
    height: 40,
    margin: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  emojiText: {
    fontSize: 18,
  },
  emojiImage: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
  emptyEmojiContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  emptyEmojiTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 8,
    marginBottom: 4,
  },
  emptyEmojiSubtitle: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 16,
  },
  joinRoomButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 20,
  },
  joinRoomButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  // Participant context menu styles
  participantContextMenu: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 8,
    marginHorizontal: 20,
    minWidth: 200,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  participantMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  participantMenuAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#229c93',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  participantMenuAvatarText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  participantMenuName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  participantMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  lastParticipantMenuItem: {
    borderBottomWidth: 0,
  },
  participantMenuText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    fontWeight: '500',
  },
  // Status indicators in participant list
  participantRoleContainer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  mutedIndicator: {
    fontSize: 12,
    color: '#9C27B0',
    fontWeight: '500',
    marginTop: 2,
  },
  blockedIndicator: {
    fontSize: 12,
    color: '#FF9800',
    fontWeight: '500',
    marginTop: 2,
  },
  // Join/Leave message styles
  joinLeaveContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  joinLeaveBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  joinBubble: {
    backgroundColor: '#E8F5E8',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  leaveBubble: {
    backgroundColor: '#FFE8E8',
    borderWidth: 1,
    borderColor: '#F44336',
  },
  joinLeaveText: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    fontWeight: '500',
  },
  joinLeaveTime: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 6,
  },
  systemMessageText: {
    fontSize: 13,
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  systemMessageTime: {
    fontSize: 10,
    color: '#AAA',
    textAlign: 'center',
    marginTop: 2,
  },
  unreadBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF6B35',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Gift Picker Styles
  giftModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  giftPickerModal: {
    backgroundColor: '#2C2C2E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 20,
  },
  giftPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  giftPickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  giftCategoryTabs: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  categoryTab: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginRight: 16,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  activeCategoryTab: {
    backgroundColor: 'transparent',
    borderBottomWidth: 2,
    borderBottomColor: '#FF8C00',
    borderRadius: 0,
  },
  categoryTabText: {
    fontSize: 16,
    color: '#888',
    fontWeight: '500',
  },
  activeCategoryTabText: {
    color: '#FF8C00',
    fontWeight: 'bold',
  },
  coinBalanceContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  coinBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  coinIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  coinText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  coinDescription: {
    fontSize: 14,
    color: '#888',
  },
  giftPickerContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  newGiftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  newGiftItemContainer: {
    width: '48%',
    marginBottom: 20,
  },
  newGiftItem: {
    backgroundColor: '#3C3C3E',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    minHeight: 140,
  },
  selectedGiftItem: {
    borderColor: '#FF8C00',
    backgroundColor: '#4A3C2A',
  },
  giftCoinIndicators: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  topLeftCoin: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topRightCoin: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomLeftCoin: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomRightCoin: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: '#4ADE80',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinIndicatorText: {
    fontSize: 12,
  },
  coinMultiplier: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  newGiftIconContainer: {
    marginTop: 16,
    marginBottom: 12,
    zIndex: 2,
  },
  giftImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  newGiftIcon: {
    fontSize: 48,
  },
  newGiftName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  newGiftPriceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinPriceIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  newGiftPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  // Legacy styles for backward compatibility
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  giftItemContainer: {
    width: '48%',
    marginBottom: 16,
  },
  giftItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  giftActionButtons: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 4,
  },
  sendToRoomButton: {
    flex: 1,
    backgroundColor: '#8B5CF6',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendToUserButton: {
    flex: 1,
    backgroundColor: '#FF69B4',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  giftActionText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  giftIconContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  giftIcon: {
    fontSize: 32,
  },
  animatedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF69B4',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedBadgeText: {
    fontSize: 10,
    color: 'white',
  },
  giftName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
    textAlign: 'center',
  },
  giftPriceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  giftPrice: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFD700',
    marginLeft: 2,
  },
  giftPreviewImage: {
    width: 32,
    height: 32,
    borderRadius: 6,
  },
  // Auto scroll button styles
  autoScrollButton: {
    position: 'absolute',
    bottom: 120, // Adjusted position to be above the input field
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  // Styles for userGiftRole, etc.
  userGiftRole: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  // Added styles for private chat history display when no rooms are active
  userListContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  userGiftItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  userGiftInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userGiftName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  selfLabel: {
    fontSize: 12,
    color: '#888',
    marginLeft: 8,
  },
  giftAnimationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  giftAnimationModal: {
    width: '90%',
    maxHeight: '70%',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  closeGiftButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    padding: 8,
  },
  giftAnimationContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  giftAnimationMediaContainer: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  giftAnimationImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  giftAnimationVideo: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  giftAnimationIcon: {
    fontSize: 80,
    color: '#FFD700',
  },
  giftAnimationInfo: {
    alignItems: 'center',
    width: '100%',
  },
  giftAnimationSender: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFD700',
    marginBottom: 8,
  },
  giftAnimationText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
    marginBottom: 12,
  },
  giftAnimationPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  giftPriceText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFD700',
    marginLeft: 4,
  },
  // User Tag Menu Styles
  userTagModalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    paddingBottom: 120,
  },
  userTagMenu: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginHorizontal: 16,
    maxHeight: 200,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  userTagHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  userTagTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  userTagList: {
    maxHeight: 150,
  },
  userTagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  userTagInfo: {
    marginLeft: 12,
    flex: 1,
  },
  userTagName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  userTagRole: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  // Message Context Menu Styles
  messageContextMenu: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 8,
    marginHorizontal: 20,
    minWidth: 180,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  messageMenuHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  messageMenuTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  messageMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  lastMessageMenuItem: {
    borderBottomWidth: 0,
  },
  messageMenuText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    fontWeight: '500',
  },
  // Mention Text Style
  mentionText: {
    color: '#8B5CF6',
    fontWeight: 'bold',
  },
});