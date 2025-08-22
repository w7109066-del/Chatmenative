import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  SafeAreaView,
  FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks';

// Use same API URL logic as AuthContext
const getApiUrl = () => {
  // Check if we're in a web environment
  if (typeof window !== 'undefined' && window.location) {
    // For web
    const currentHost = window.location.host;
    const protocol = window.location.protocol;
    if (currentHost && currentHost.includes('replit.dev')) {
      return `${protocol}//${currentHost.replace(':3000', ':5000')}`;
    }
    return 'https://2b1a8762-7688-43fb-b119-1097a355d8a8-00-2qggmgbre9lxw.pike.replit.dev';
  }
  // For mobile/React Native
  return 'https://2b1a8762-7688-43fb-b119-1097a355d8a8-00-2qggmgbre9lxw.pike.replit.dev';
};

const API_BASE_URL = getApiUrl();

interface UserProfile {
  id: string;
  username: string;
  bio: string;
  followers: number;
  following: number;
  avatar?: string;
  level: number;
  achievements: Achievement[];
  isOnline: boolean;
  country?: string;
  albumPhotos?: AlbumPhoto[];
  gifts?: Gift[];
}

interface Achievement {
  id: string;
  name: string;
  icon: string;
  color: string;
  count?: number;
}

interface AlbumPhoto {
  id: string;
  url: string;
  filename: string;
  uploadedAt: string;
}

interface Gift {
  id: string;
  name: string;
  icon: string;
  count: number;
  color: string;
}

export default function ProfileScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [albumPhotos, setAlbumPhotos] = useState<AlbumPhoto[]>([]);

  // Get user ID from route params or use current user
  const userId = route?.params?.userId || user?.id;
  const isOwnProfile = userId === user?.id;

  useEffect(() => {
    fetchUserProfile();
    fetchAlbumPhotos();
  }, [userId]);

  const fetchUserProfile = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${userId}/profile`, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        const profileData = await response.json();
        // Process avatar URL
        if (profileData.avatar && profileData.avatar.startsWith('/api/')) {
          profileData.avatar = `${API_BASE_URL}${profileData.avatar}`;
        }

        // Fetch gifts from API
        try {
          const giftsResponse = await fetch(`${API_BASE_URL}/api/users/${userId}/gifts`, {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ChatMe-Mobile-App',
            },
          });
          if (giftsResponse.ok) {
            profileData.gifts = await giftsResponse.json();
          } else {
            profileData.gifts = [];
          }
        } catch (error) {
          console.error('Error fetching gifts:', error);
          profileData.gifts = [];
        }

        setProfile(profileData);
        setIsFollowing(profileData.isFollowing || false);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const fetchAlbumPhotos = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${userId}/album`, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMe-Mobile-App',
        },
      });

      if (response.ok) {
        const photos = await response.json();
        setAlbumPhotos(photos);
      }
    } catch (error) {
      console.error('Error fetching album:', error);
    }
  };

  const handleFollow = async () => {
    if (!profile || isOwnProfile) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${userId}/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.token}`,
        },
        body: JSON.stringify({
          action: isFollowing ? 'unfollow' : 'follow'
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setIsFollowing(!isFollowing);
        setProfile(prev => prev ? {
          ...prev,
          followers: isFollowing ? prev.followers - 1 : prev.followers + 1
        } : null);
      }
    } catch (error) {
      console.error('Error following user:', error);
      Alert.alert('Error', 'Failed to update follow status');
    }
  };

  const handleMessage = async () => {
    if (profile && user) {
      try {
        console.log('Creating private chat between:', user.username, 'and', profile.username);
        
        // Create private chat via API
        const response = await fetch(`${API_BASE_URL}/api/chat/private`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ChatMe-Mobile-App',
          },
          body: JSON.stringify({
            participants: [user.username, profile.username],
            initiatedBy: user.username
          }),
        });

        console.log('Private chat response status:', response.status);

        if (response.ok) {
          const privateChat = await response.json();
          console.log(privateChat.isExisting ? 'Existing private chat found:' : 'Private chat created successfully:', privateChat.id);

          // Navigate to ChatScreen with private chat data
          navigation.navigate('Chat', { 
            roomId: privateChat.id,
            roomName: `Chat with ${profile.username}`,
            roomDescription: `Private chat with ${profile.username}`,
            type: 'private',
            targetUser: profile,
            autoFocusTab: true
          });
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Private chat creation failed:', errorData);
          throw new Error(errorData.error || `HTTP ${response.status}: Failed to create private chat`);
        }
      } catch (error) {
        console.error('Error creating private chat:', error);
        Alert.alert('Error', error.message || 'Failed to start private chat');
      }
    }
  };

  const renderAlbumPhoto = ({ item }: { item: AlbumPhoto }) => (
    <View style={styles.albumPhotoItem}>
      <Image 
        source={{ uri: `${API_BASE_URL}${item.url}` }} 
        style={styles.albumPhotoImage} 
      />
    </View>
  );

  const renderGift = ({ item }: { item: Gift }) => (
    <View style={styles.giftItem}>
      <Text style={styles.giftIcon}>{item.icon}</Text>
      <Text style={styles.giftCount}>{item.count}</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Profile not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with background image */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton}>
          <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Background Image Area */}
        <View style={styles.backgroundImageContainer}>
          <Image 
            source={{ 
              uri: albumPhotos.length > 0 
                ? `${API_BASE_URL}${albumPhotos[0].url}` 
                : 'https://images.unsplash.com/photo-1557804506-669a67965ba0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80'
            }} 
            style={styles.backgroundImage} 
          />

          {/* Living Status */}
          {profile.isOnline && (
            <View style={styles.livingStatus}>
              <View style={styles.livingDot} />
              <Text style={styles.livingText}>Living</Text>
            </View>
          )}
        </View>

        {/* Profile Content */}
        <View style={styles.profileContent}>
          {/* Avatar with decorative frame */}
          <View style={styles.avatarContainer}>
            <View style={styles.avatarFrame}>
              <View style={styles.avatarInner}>
                {profile.avatar ? (
                  <Image source={{ uri: profile.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.defaultAvatar}>
                    <Text style={styles.avatarText}>
                      {profile.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* User Info */}
          <View style={styles.userInfo}>
            <View style={styles.nameContainer}>
              <Text style={styles.username}>{profile.username}</Text>
              <Text style={styles.userRole}></Text>
            </View>

            {/* Country Flag */}
            {profile.country && (
              <View style={styles.countryContainer}>
                <Text style={styles.countryFlag}>🇮🇩</Text>
              </View>
            )}

            {/* Stats */}
            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>ikuti</Text>
                <Text style={styles.statNumber}>{profile.following}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Pengemar</Text>
                <Text style={styles.statNumber}>{profile.followers}</Text>
              </View>
            </View>

            {/* Bio */}
            {profile.bio && (
              <Text style={styles.bio}>{profile.bio}</Text>
            )}
          </View>

          {/* Action Buttons */}
          {!isOwnProfile && (
            <View style={styles.actionButtons}>
              <TouchableOpacity onPress={handleFollow}>
                <LinearGradient
                  colors={isFollowing ? ['#E0E0E0', '#BDBDBD'] : ['#FF69B4', '#FF1493']}
                  style={styles.followButton}
                >
                  <Text style={[
                    styles.followButtonText,
                    isFollowing && { color: '#666' }
                  ]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity style={styles.messageButton} onPress={handleMessage}>
                <Ionicons name="chatbubble" size={16} color="#FF69B4" />
              </TouchableOpacity>
            </View>
          )}

          {/* Album Photos */}
          {albumPhotos.length > 0 && (
            <View style={styles.albumSection}>
              <Text style={styles.sectionTitle}>Album</Text>
              <FlatList
                data={albumPhotos.slice(0, 6)} // Show max 6 photos
                renderItem={renderAlbumPhoto}
                numColumns={3}
                scrollEnabled={false}
                contentContainerStyle={styles.albumGrid}
              />
            </View>
          )}

          {/* Gifts Received */}
          {profile.gifts && profile.gifts.length > 0 && (
            <View style={styles.giftsSection}>
              <Text style={styles.sectionTitle}>Hadiah yang Diterima</Text>
              <FlatList
                data={profile.gifts}
                renderItem={renderGift}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.giftsContainer}
              />
            </View>
          )}

          {/* Additional Actions for Own Profile */}
          {isOwnProfile && (
            <View style={styles.ownProfileActions}>
              <TouchableOpacity 
                style={styles.editButton}
                onPress={() => navigation.navigate('EditProfile')}
              >
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  menuButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#333',
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#333',
    fontSize: 16,
  },
  backgroundImageContainer: {
    height: 300,
    position: 'relative',
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  livingStatus: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF69B4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  livingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 6,
  },
  livingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  profileContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    marginTop: -25,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: -50,
    marginBottom: 20,
  },
  avatarFrame: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: '#FF69B4',
    padding: 2,
    backgroundColor: '#fff',
  },
  avatarInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    overflow: 'hidden',
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
  },
  defaultAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  userInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  username: {
    color: '#333',
    fontSize: 22,
    fontWeight: 'bold',
    marginRight: 8,
  },
  userRole: {
    color: '#FF69B4',
    fontSize: 18,
    fontWeight: '600',
  },
  countryContainer: {
    marginBottom: 15,
  },
  countryFlag: {
    fontSize: 24,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  statItem: {
    alignItems: 'center',
    marginHorizontal: 25,
  },
  statLabel: {
    color: '#666',
    fontSize: 14,
    marginBottom: 2,
  },
  statNumber: {
    color: '#333',
    fontSize: 18,
    fontWeight: 'bold',
  },
  bio: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    gap: 15,
  },
  followButton: {
    paddingHorizontal: 25,
    paddingVertical: 8,
    borderRadius: 20,
  },
  followButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  messageButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#FF69B4',
    padding: 8,
    borderRadius: 20,
  },
  albumSection: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  albumGrid: {
    gap: 8,
  },
  albumPhotoItem: {
    flex: 1,
    margin: 4,
  },
  albumPhotoImage: {
    width: '100%',
    height: 100,
    borderRadius: 8,
  },
  giftsSection: {
    marginBottom: 25,
  },
  giftsContainer: {
    paddingRight: 20,
  },
  giftItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    alignItems: 'center',
    minWidth: 60,
  },
  giftIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  giftCount: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  ownProfileActions: {
    marginBottom: 30,
  },
  editButton: {
    backgroundColor: '#FF69B4',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});