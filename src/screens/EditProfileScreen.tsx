
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView,
  TextInput,
  Alert,
  Image,
  FlatList,
  Modal,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks';
import * as ImagePicker from 'expo-image-picker';

// Use different API URLs for web and mobile
const getApiUrl = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location) {
      const currentHost = window.location.host;
      const protocol = window.location.protocol;
      if (currentHost && currentHost.includes('replit.dev')) {
        return `${protocol}//${currentHost.replace(':3000', ':5000')}`;
      }
    }
    return 'https://934cad12-b01b-4e03-a1f9-4b83b3925e05-00-1t8gilzoxt242.pike.replit.dev:5000';
  }
  return 'https://934cad12-b01b-4e03-a1f9-4b83b3925e05-00-1t8gilzoxt242.pike.replit.dev';
};

const API_BASE_URL = getApiUrl();

interface AlbumPhoto {
  id: string;
  url: string;
  filename: string;
  uploadedAt: string;
}

export default function EditProfileScreen({ navigation }: any) {
  const { user, updateProfile } = useAuth();
  const [profileData, setProfileData] = useState({
    username: user?.username || 'pengembang',
    email: user?.email || 'meongkwl@gmail.com',
    bio: user?.bio || 'there\'s nothing special',
    phone: user?.phone || '+62 812 3456 7890',
    gender: user?.gender || 'Pria',
    birthDate: user?.birthDate || '1995-03-24',
    country: user?.country || 'Indonesia',
    signature: user?.signature || 'there\'s nothing special',
    avatar: user?.avatar || null
  });

  const [albumPhotos, setAlbumPhotos] = useState<AlbumPhoto[]>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [currentUploadType, setCurrentUploadType] = useState<'avatar' | 'album'>('avatar');
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  useEffect(() => {
    fetchAlbumPhotos();
  }, []);

  const fetchAlbumPhotos = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${user?.id}/album`);
      if (response.ok) {
        const photos = await response.json();
        setAlbumPhotos(photos);
      }
    } catch (error) {
      console.error('Error fetching album:', error);
    }
  };

  const handleImagePicker = (type: 'avatar' | 'album') => {
    setCurrentUploadType(type);
    setShowImagePicker(true);
  };

  const pickImageFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: currentUploadType === 'avatar' ? [1, 1] : [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await uploadImage(asset.base64!, asset.uri.split('/').pop() || 'image.jpg');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
    setShowImagePicker(false);
  };

  const takePhoto = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: currentUploadType === 'avatar' ? [1, 1] : [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await uploadImage(asset.base64!, asset.uri.split('/').pop() || 'image.jpg');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo');
    }
    setShowImagePicker(false);
  };

  const uploadImage = async (base64Data: string, filename: string) => {
    try {
      if (currentUploadType === 'avatar') {
        console.log('Uploading avatar for user:', user?.id);
        const response = await fetch(`${API_BASE_URL}/api/users/${user?.id}/avatar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            avatar: base64Data,
            filename
          }),
        });

        const result = await response.json();
        console.log('Avatar upload response:', result);

        if (response.ok) {
          setProfileData(prev => ({ ...prev, avatar: result.avatarUrl }));
          
          // Update user context by calling the profile update endpoint directly
          try {
            const profileResponse = await fetch(`${API_BASE_URL}/api/profile/${user?.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                avatar: result.avatarUrl
              }),
            });

            if (profileResponse.ok) {
              const updatedUser = await profileResponse.json();
              await updateProfile(updatedUser);
              Alert.alert('Success', 'Avatar berhasil diperbarui!');
            } else {
              Alert.alert('Success', 'Avatar uploaded but profile update failed');
            }
          } catch (profileError) {
            console.error('Profile update error:', profileError);
            Alert.alert('Success', 'Avatar uploaded successfully');
          }
        } else {
          Alert.alert('Error', result.error || 'Gagal mengupload avatar');
        }
      } else {
        console.log('Uploading album photo for user:', user?.id);
        const response = await fetch(`${API_BASE_URL}/api/users/${user?.id}/album`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            photo: base64Data,
            filename
          }),
        });

        const result = await response.json();
        console.log('Album upload response:', result);

        if (response.ok) {
          setAlbumPhotos(prev => [...prev, result]);
          Alert.alert('Success', 'Foto berhasil ditambahkan ke album!');
        } else {
          Alert.alert('Error', result.error || 'Gagal mengupload foto');
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Error', 'Gagal mengupload gambar');
    }
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/${user?.id}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: profileData.username,
          bio: profileData.bio,
          phone: profileData.phone,
          gender: profileData.gender,
          birthDate: profileData.birthDate,
          country: profileData.country,
          signature: profileData.signature
        }),
      });

      if (response.ok) {
        await updateProfile({
          username: profileData.username,
          bio: profileData.bio,
          phone: profileData.phone
        });
        Alert.alert('Success', 'Profile berhasil diperbarui!');
        navigation.goBack();
      } else {
        Alert.alert('Error', 'Gagal memperbarui profile');
      }
    } catch (error) {
      Alert.alert('Error', 'Gagal memperbarui profile');
    }
  };

  const renderAlbumPhoto = ({ item }: { item: AlbumPhoto }) => (
    <View style={styles.albumPhotoContainer}>
      <Image source={{ uri: `${API_BASE_URL}${item.url}` }} style={styles.albumPhoto} />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sunting</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Avatar</Text>
            <TouchableOpacity 
              style={styles.avatarContainer} 
              onPress={() => handleImagePicker('avatar')}
            >
              <View style={styles.avatar}>
                {profileData.avatar ? (
                  <Image source={{ uri: `${API_BASE_URL}${profileData.avatar}` }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>
                    {profileData.username.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Album Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Album</Text>
          <Text style={styles.sectionSubtitle}>
            Klik untuk mengubah atau menghapus foto. Seret foto untuk mengubah urutan.
          </Text>
          
          <View style={styles.albumContainer}>
            <TouchableOpacity 
              style={styles.addPhotoButton}
              onPress={() => handleImagePicker('album')}
            >
              <Ionicons name="add" size={30} color="#999" />
            </TouchableOpacity>
            
            {albumPhotos.map((photo) => (
              <View key={photo.id} style={styles.albumPhotoContainer}>
                <Image source={{ uri: `${API_BASE_URL}${photo.url}` }} style={styles.albumPhoto} />
              </View>
            ))}
          </View>
          
          <Text style={styles.albumNote}>* Hanya tampilkan 5 foto pertama di beranda</Text>
        </View>

        {/* Profile Form */}
        <View style={styles.section}>
          {/* Username */}
          <View style={styles.formItem}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Username</Text>
              <TextInput
                style={styles.textInput}
                value={profileData.username}
                onChangeText={(text) => setProfileData(prev => ({ ...prev, username: text }))}
                placeholder="Masukkan username"
              />
            </View>
          </View>

          {/* Bio */}
          <View style={styles.formItem}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Bio</Text>
              <TextInput
                style={[styles.textInput, styles.multilineInput]}
                value={profileData.bio}
                onChangeText={(text) => setProfileData(prev => ({ ...prev, bio: text }))}
                placeholder="Ceritakan tentang diri Anda"
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.formItem}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Telepon</Text>
              <TextInput
                style={styles.textInput}
                value={profileData.phone}
                onChangeText={(text) => setProfileData(prev => ({ ...prev, phone: text }))}
                placeholder="Nomor telepon"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* Gender */}
          <TouchableOpacity style={styles.formItem} onPress={() => setShowGenderPicker(true)}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Jenis kelamin</Text>
              <Text style={styles.formValue}>{profileData.gender}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#999" />
          </TouchableOpacity>

          {/* Birth Date */}
          <TouchableOpacity style={styles.formItem} onPress={() => setShowDatePicker(true)}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Ulang tahun</Text>
              <Text style={styles.formValue}>{profileData.birthDate}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#999" />
          </TouchableOpacity>

          {/* Country */}
          <TouchableOpacity style={styles.formItem} onPress={() => setShowCountryPicker(true)}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Negara/Wilayah</Text>
              <Text style={styles.formValue}>{profileData.country}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#999" />
          </TouchableOpacity>

          {/* Signature */}
          <View style={styles.formItem}>
            <View style={styles.formHeader}>
              <Text style={styles.formLabel}>Tanda tangan</Text>
              <TextInput
                style={styles.textInput}
                value={profileData.signature}
                onChangeText={(text) => setProfileData(prev => ({ ...prev, signature: text }))}
                placeholder="Tanda tangan Anda"
              />
            </View>
          </View>
        </View>

        {/* Save Button */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Simpan Perubahan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Gender Picker Modal */}
      <Modal
        visible={showGenderPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowGenderPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pilih Jenis Kelamin</Text>
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setProfileData(prev => ({ ...prev, gender: 'Pria' }));
                setShowGenderPicker(false);
              }}
            >
              <Text style={styles.modalButtonText}>Pria</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setProfileData(prev => ({ ...prev, gender: 'Wanita' }));
                setShowGenderPicker(false);
              }}
            >
              <Text style={styles.modalButtonText}>Wanita</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.modalButton, styles.cancelButton]} 
              onPress={() => setShowGenderPicker(false)}
            >
              <Text style={styles.cancelButtonText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Country Picker Modal */}
      <Modal
        visible={showCountryPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pilih Negara/Wilayah</Text>
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setProfileData(prev => ({ ...prev, country: 'Indonesia' }));
                setShowCountryPicker(false);
              }}
            >
              <Text style={styles.modalButtonText}>Indonesia</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setProfileData(prev => ({ ...prev, country: 'Malaysia' }));
                setShowCountryPicker(false);
              }}
            >
              <Text style={styles.modalButtonText}>Malaysia</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setProfileData(prev => ({ ...prev, country: 'Singapura' }));
                setShowCountryPicker(false);
              }}
            >
              <Text style={styles.modalButtonText}>Singapura</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.modalButton, styles.cancelButton]} 
              onPress={() => setShowCountryPicker(false)}
            >
              <Text style={styles.cancelButtonText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      <Modal
        visible={showDatePicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Pilih Tanggal Lahir</Text>
            <Text style={styles.modalSubtitle}>Format: YYYY-MM-DD</Text>
            
            <TextInput
              style={styles.dateInput}
              value={profileData.birthDate}
              onChangeText={(text) => setProfileData(prev => ({ ...prev, birthDate: text }))}
              placeholder="1995-03-24"
            />
            
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.modalButtonText}>Simpan</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.modalButton, styles.cancelButton]} 
              onPress={() => setShowDatePicker(false)}
            >
              <Text style={styles.cancelButtonText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Image Picker Modal */}
      <Modal
        visible={showImagePicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowImagePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upload Photo</Text>
            <Text style={styles.modalSubtitle}>Pilih sumber foto</Text>
            
            <TouchableOpacity style={styles.modalButton} onPress={takePhoto}>
              <Ionicons name="camera" size={24} color="#007AFF" />
              <Text style={styles.modalButtonText}>Camera</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.modalButton} onPress={pickImageFromLibrary}>
              <Ionicons name="images" size={24} color="#007AFF" />
              <Text style={styles.modalButtonText}>Gallery</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.modalButton, styles.cancelButton]} 
              onPress={() => setShowImagePicker(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerRight: {
    width: 34,
  },
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
    lineHeight: 20,
  },
  avatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  albumContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 10,
  },
  albumPhotoContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 10,
    marginBottom: 10,
  },
  albumPhoto: {
    width: '100%',
    height: '100%',
  },
  albumNote: {
    fontSize: 12,
    color: '#FF6B6B',
    fontStyle: 'italic',
  },
  formItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  formHeader: {
    flex: 1,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  formValue: {
    fontSize: 14,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 5,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#F8F9FA',
    marginBottom: 10,
  },
  modalButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 15,
    fontWeight: '500',
  },
  cancelButton: {
    backgroundColor: '#FF6B6B',
    marginTop: 10,
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
    flex: 1,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    marginTop: 5,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 20,
    width: '100%',
  },
});
