import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  RefreshControl,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks';

type StatusType = 'online' | 'offline' | 'away' | 'busy';

interface Friend {
  id: string;
  name: string;
  status: StatusType;
  lastSeen?: string;
  avatar?: string;
}

// Placeholder for Room type, assuming it's defined elsewhere
interface Room {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: string;
}

const HomeScreen = ({ navigation }: any) => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState(0);
  const [userStatus, setUserStatus] = useState<StatusType>('online');
  const [searchText, setSearchText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const { token } = useAuth();

  // API configuration
  const getApiUrl = () => {
    return 'https://2968a09a-ea9e-4400-aa61-da927ebc2b19-00-kk2da6734ef9.sisko.replit.dev';
  };

  // Fetch friends from server
  const fetchFriends = async () => {
    try {
      setLoading(true);
      console.log('Fetching friends from:', `${getApiUrl()}/api/friends`);

      const response = await fetch(`${getApiUrl()}/api/friends`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      console.log('Friends response status:', response.status);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const errorText = await response.text();
        console.error('Non-JSON response for friends:', errorText.substring(0, 500));
        throw new Error(`Server returned HTML error page. Status: ${response.status}`);
      }

      if (response.ok) {
        const friendsData = await response.json();
        console.log('Friends data received:', friendsData.length, 'friends');
        setFriends(friendsData);
      } else {
        const errorData = await response.json();
        console.error('Friends fetch failed:', response.status, errorData);
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error fetching friends:', error);
      // Set empty array instead of showing alert for better UX
      setFriends([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch rooms from server (assuming this function exists and is needed)
  const fetchRooms = async () => {
    try {
      console.log('Fetching rooms from:', `${getApiUrl()}/api/rooms`);

      const response = await fetch(`${getApiUrl()}/api/rooms`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      console.log('Rooms response status:', response.status);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const errorText = await response.text();
        console.error('Non-JSON response for rooms:', errorText.substring(0, 500));
        throw new Error(`Server returned HTML error page. Status: ${response.status}`);
      }

      if (response.ok) {
        const roomsData = await response.json();
        console.log('Rooms data received:', roomsData.length, 'rooms');
        setRooms(roomsData);
      } else {
        const errorData = await response.json();
        console.error('Rooms fetch failed:', response.status, errorData);
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
      // Set empty array instead of showing alert
      setRooms([]);
    }
  };

  // Search users
  const searchUsers = async (query: string) => {
    try {
      if (!token) {
        console.log('No token available for user search');
        return;
      }

      const response = await fetch(`${getApiUrl()}/api/users/search?query=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      console.log('User search response status:', response.status);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const errorText = await response.text();
        console.error('Non-JSON response for user search:', errorText.substring(0, 500));
        throw new Error(`Server returned HTML error page. Status: ${response.status}`);
      }

      if (response.ok) {
        const usersData = await response.json();
        setFriends(usersData); // Use friends state to display search results
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to search users');
      }
    } catch (error) {
      console.error('Error searching users:', error);
      // Don't show alert for better UX, just log the error
      setFriends([]);
    }
  };

  // Search friends
  const searchFriends = async (query: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/friends/search?query=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        const friendsData = await response.json();
        setFriends(friendsData);
      } else {
        throw new Error('Failed to search friends');
      }
    } catch (error) {
      console.error('Error searching friends:', error);
      Alert.alert('Error', 'Failed to search friends');
    }
  };

  // Update user status
  const updateUserStatus = async (newStatus: StatusType) => {
    try {
      const response = await fetch(`${getApiUrl()}/api/user/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setUserStatus(newStatus);
      } else {
        throw new Error('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'Failed to update status');
    }
  };

  // Load friends and rooms on component mount
  useEffect(() => {
    fetchRooms();
    fetchFriends();
    fetchActiveUsers();
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/notifications`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadNotifications(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const fetchActiveUsers = async () => {
    try {
      // Mock active users for now - in real app, get from admin dashboard
      setActiveUsers(Math.floor(Math.random() * 100) + 50);
    } catch (error) {
      console.error('Error fetching active users:', error);
      setActiveUsers(75); // Default fallback
    }
  };

  // Handle search with debounce
  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (searchText.trim() && searchText.length >= 2) {
        // Search users when query has 2 or more characters
        searchUsers(searchText);
      } else if (searchText.trim() && searchText.length === 1) {
        // Keep existing friends list for single character
        return;
      } else {
        // Load friends when search is empty
        fetchFriends();
      }
    }, 300); // Reduced delay for faster response

    return () => clearTimeout(delayedSearch);
  }, [searchText]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFriends();
    await fetchRooms(); // Also refresh rooms on pull-to-refresh
    await fetchActiveUsers(); // Also refresh active users
    setRefreshing(false);
  };

  const getStatusColor = (status: StatusType) => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'offline': return '#9E9E9E';
      case 'away': return '#FF9800';
      case 'busy': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const getStatusText = (status: StatusType) => {
    switch (status) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'away': return 'Away';
      case 'busy': return 'Busy';
      default: return 'Offline';
    }
  };

  const toggleStatus = () => {
    const statuses: StatusType[] = ['online', 'away', 'busy', 'offline'];
    const currentIndex = statuses.indexOf(userStatus);
    const nextIndex = (currentIndex + 1) % statuses.length;
    updateUserStatus(statuses[nextIndex]);
  };

  const renderFriend = (friend: Friend) => (
    <View key={friend.id} style={styles.friendCard}>
      <View style={styles.friendInfo}>
        <View style={styles.friendAvatarContainer}>
          {friend.avatar?.startsWith('http') ? (
            <Image source={{ uri: friend.avatar }} style={styles.friendAvatar} />
          ) : (
            <View style={[styles.friendAvatar, { backgroundColor: friend.status === 'online' ? '#FF6B6B' : '#9E9E9E' }]}>
              <Text style={styles.friendAvatarText}>{friend.avatar}</Text>
            </View>
          )}
          <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(friend.status) }]} />
        </View>
        <View style={styles.friendDetails}>
          <Text style={styles.friendName}>{friend.name}</Text>
          <Text style={styles.friendStatus}>{friend.lastSeen}</Text>
        </View>
      </View>
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(friend.status) }]} />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header with Avatar and Controls */}
      <LinearGradient
        colors={['#8B5CF6', '#3B82F6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <View style={styles.userInfo}>
          <View style={styles.userAvatarContainer}>
            <View style={styles.userAvatar}>
              {user?.avatar ? (
                <Image source={{ uri: `${getApiUrl()}${user.avatar}` }} style={styles.userAvatarImage} />
              ) : (
                <Text style={styles.userAvatarText}>
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </Text>
              )}
            </View>
            <View style={[styles.userStatusIndicator, { backgroundColor: getStatusColor(userStatus) }]} />
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.username}>{user?.username || 'developer'}</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>1</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerControls}>
          <TouchableOpacity style={styles.controlButton} onPress={toggleStatus}>
            <View style={[styles.statusIndicatorLarge, { backgroundColor: getStatusColor(userStatus) }]} />
            <Text style={styles.statusLabel}>{getStatusText(userStatus)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="search" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.iconButton, styles.notificationButton]} onPress={() => navigation.navigate('Notifications')}>
            <Ionicons name="notifications" size={24} color="#fff" />
            {unreadNotifications > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationText}>
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Friends Section */}
      <View style={styles.friendsSection}>
        <View style={styles.friendsHeader}>
          <Text style={styles.friendsTitle}>Friends</Text>
          <View style={styles.friendsControls}>
            <TouchableOpacity style={styles.trophyButton}>
              <Ionicons name="trophy" size={20} color="#FF9800" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshButton} onPress={fetchFriends}>
              <Ionicons name="refresh" size={20} color="#9C27B0" />
              <Text style={styles.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users... (min 2 characters)"
            value={searchText}
            onChangeText={setSearchText}
            placeholderTextColor="#999"
          />
          {searchText.length >= 2 && (
            <View style={styles.searchTypeIndicator}>
              <Text style={styles.searchTypeText}>Users</Text>
            </View>
          )}
        </View>

        <ScrollView
          style={styles.friendsList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {loading && friends.length === 0 ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading friends...</Text>
            </View>
          ) : friends.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={60} color="#ccc" />
              <Text style={styles.emptyTitle}>
                {searchText.length >= 2 ? 'No Users Found' : 'No Friends Found'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchText.length >= 2
                  ? 'No users match your search term'
                  : searchText.length === 1
                  ? 'Type at least 2 characters to search users'
                  : 'Start adding friends to see them here'}
              </Text>
            </View>
          ) : (
            friends.map(renderFriend)
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatarContainer: {
    position: 'relative',
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  userAvatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  userStatusIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  userDetails: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  levelBadge: {
    backgroundColor: '#9C27B0',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  levelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  statusIndicatorLarge: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 5,
  },
  statusLabel: {
    fontSize: 12,
    color: '#666',
  },
  iconButton: {
    padding: 8,
    marginLeft: 8,
  },
  friendsSection: {
    flex: 1,
    padding: 20,
  },
  friendsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  friendsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  friendsControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trophyButton: {
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF9800',
    marginRight: 10,
  },
  refreshButton: {
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#9C27B0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshText: {
    color: '#9C27B0',
    marginLeft: 5,
    fontSize: 14,
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#eee',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  searchTypeIndicator: {
    backgroundColor: '#9C27B0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  searchTypeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  friendsList: {
    flex: 1,
  },
  friendCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  friendAvatarContainer: {
    position: 'relative',
  },
  friendAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  friendDetails: {
    marginLeft: 12,
    flex: 1,
  },
  friendName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  friendStatus: {
    fontSize: 14,
    color: '#666',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Styles for header added for active users display
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeUsersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 12,
  },
  activeUsersText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginLeft: 4,
  },
  notificationButton: {
    position: 'relative',
    padding: 8,
  },
  notificationBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  notificationButton: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#fff',
  },
});

export default HomeScreen;