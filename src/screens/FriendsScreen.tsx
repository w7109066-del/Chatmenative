
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
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks';
import { useNavigation } from '@react-navigation/native';

const API_BASE_URL = 'https://2968a09a-ea9e-4400-aa61-da927ebc2b19-00-kk2da6734ef9.sisko.replit.dev';

type StatusType = 'online' | 'offline' | 'away' | 'busy';

interface Friend {
  id: string;
  name: string;
  username: string;
  status: StatusType;
  lastSeen?: string;
  avatar?: string;
}

export default function FriendsScreen() {
  const { user, authToken } = useAuth();
  const navigation = useNavigation();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getStatusColor = (status: StatusType): string => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'away': return '#FF9800';
      case 'busy': return '#F44336';
      case 'offline': return '#9E9E9E';
      default: return '#9E9E9E';
    }
  };

  const fetchFriends = async () => {
    if (!user?.username || !authToken) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/friends`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Friends data:', data);
        
        // Transform the data to match our Friend interface
        const transformedFriends = data.map((friend: any) => ({
          id: friend.id?.toString() || friend.user_id?.toString(),
          name: friend.name || friend.username,
          username: friend.username,
          status: friend.status || 'offline',
          lastSeen: friend.last_seen || friend.lastSeen || 'Recently',
          avatar: friend.avatar || friend.username?.charAt(0).toUpperCase()
        }));
        
        setFriends(transformedFriends);
      } else {
        console.error('Failed to fetch friends:', response.status);
      }
    } catch (error) {
      console.error('Error fetching friends:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const searchUsers = async (query: string) => {
    if (query.length < 2) {
      fetchFriends();
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/users/search?query=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const transformedUsers = data.map((user: any) => ({
          id: user.id?.toString(),
          name: user.name || user.username,
          username: user.username,
          status: user.status || 'offline',
          lastSeen: user.last_seen || 'Recently',
          avatar: user.avatar || user.username?.charAt(0).toUpperCase()
        }));
        setFriends(transformedUsers);
      }
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const addFriend = async (friendId: string, friendName: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${friendId}/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        Alert.alert('Success', `Added ${friendName} as a friend!`);
        fetchFriends();
      } else {
        Alert.alert('Error', 'Failed to add friend');
      }
    } catch (error) {
      console.error('Error adding friend:', error);
      Alert.alert('Error', 'Failed to add friend');
    }
  };

  const startChat = (friendId: string, friendName: string) => {
    navigation.navigate('Chat', {
      roomId: `private_${user?.id}_${friendId}`,
      roomName: friendName,
      type: 'private',
      targetUser: { id: friendId, username: friendName }
    });
  };

  const onRefresh = () => {
    setRefreshing(true);
    setSearchText('');
    fetchFriends();
  };

  useEffect(() => {
    fetchFriends();
  }, [user, authToken]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchUsers(searchText);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchText]);

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
      
      <View style={styles.actionButtons}>
        {searchText.length >= 2 ? (
          <>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => addFriend(friend.id, friend.name)}
            >
              <Ionicons name="person-add" size={20} color="#4CAF50" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => startChat(friend.id, friend.name)}
            >
              <Ionicons name="chatbubble" size={20} color="#2196F3" />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => startChat(friend.id, friend.name)}
          >
            <Ionicons name="chatbubble" size={20} color="#2196F3" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Friends</Text>
          <Text style={styles.headerSubtitle}>Connect with your friends</Text>
        </View>
      </LinearGradient>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends or users..."
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor="#999"
        />
        {searchText.length >= 2 && (
          <View style={styles.searchTypeIndicator}>
            <Text style={styles.searchTypeText}>USERS</Text>
          </View>
        )}
      </View>

      {/* Friends List */}
      <ScrollView
        style={styles.friendsList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loading && friends.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#667eea" />
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 30,
    paddingHorizontal: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 12,
    margin: 20,
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
    paddingHorizontal: 20,
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
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
