package music

import (
	"context"
	"testing"

	"github.com/anzhiyu-c/anheyu-app/pkg/constant"
)

type fakeSettingService struct {
	values map[string]string
}

func (f fakeSettingService) LoadAllSettings(ctx context.Context) error { return nil }

func (f fakeSettingService) Get(key string) string {
	return f.values[key]
}

func (f fakeSettingService) GetBool(key string) bool { return false }

func (f fakeSettingService) GetByKeys(keys []string) map[string]interface{} {
	return map[string]interface{}{}
}

func (f fakeSettingService) GetSiteConfig() map[string]interface{} {
	return map[string]interface{}{}
}

func (f fakeSettingService) GetConfigVersion() int64 { return 0 }

func (f fakeSettingService) UpdateSettings(ctx context.Context, settingsToUpdate map[string]string) error {
	return nil
}

func (f fakeSettingService) RegisterPublicSettings(keys []string) {}

func (f fakeSettingService) IsPublicSetting(key string) bool { return false }

func TestNewMusicServiceTrimsConfiguredAPIBaseURL(t *testing.T) {
	svc := NewMusicService(fakeSettingService{
		values: map[string]string{
			constant.KeyMusicAPIBaseURL.String(): " https://metings.qjqq.cn/ ",
		},
	})

	ms, ok := svc.(*musicService)
	if !ok {
		t.Fatalf("NewMusicService returned %T, want *musicService", svc)
	}

	if got, want := ms.playlistAPI, "https://metings.qjqq.cn/Playlist"; got != want {
		t.Fatalf("playlistAPI = %q, want %q", got, want)
	}
	if got, want := ms.songAPI, "https://metings.qjqq.cn/Song_V1"; got != want {
		t.Fatalf("songAPI = %q, want %q", got, want)
	}
}
