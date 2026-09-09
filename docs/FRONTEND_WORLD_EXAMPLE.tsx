/**
 * Example React component for World ID Selfie Check integration
 * 
 * Member 5 can use this as a starting point for the frontend verification UI.
 * This component handles the full flow: trigger verification → get proof → publish service
 */

import { useState } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

// Initialize MiniKit (do this once in your app root)
// MiniKit.install(import.meta.env.VITE_WORLD_APP_ID);

interface ServiceFormData {
  name: string;
  description: string;
  endpoint: string;
  queryType: 'ip' | 'hash';
  priceHbar: number;
}

export function PublishServiceForm() {
  const [formData, setFormData] = useState<ServiceFormData>({
    name: '',
    description: '',
    endpoint: '',
    queryType: 'ip',
    priceHbar: 0.01,
  });
  
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleVerifyAndPublish = async () => {
    setError(null);
    setIsVerifying(true);

    try {
      // Step 1: Trigger World ID verification (Selfie Check)
      const { proof } = await MiniKit.commandVerify({
        action: 'publish-service',
        signal: '', // Empty for Selfie Check
        verification_level: 'device', // or 'orb' for higher security
      });

      if (!proof) {
        throw new Error('Verification cancelled or failed');
      }

      setIsVerifying(false);
      setIsPublishing(true);

      // Step 2: Send to backend with the proof
      const response = await fetch('/marketplace/services', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Selfie-Check-Proof': JSON.stringify(proof),
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to publish service');
      }

      const service = await response.json();
      console.log('Service published:', service);
      
      setSuccess(true);
      setIsPublishing(false);
      
      // Reset form after success
      setTimeout(() => {
        setFormData({
          name: '',
          description: '',
          endpoint: '',
          queryType: 'ip',
          priceHbar: 0.01,
        });
        setSuccess(false);
      }, 3000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setIsVerifying(false);
      setIsPublishing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Publish a Service</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      
      {success && (
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          Service published successfully!
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Service Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border rounded"
            placeholder="IP Reputation Service"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border rounded"
            placeholder="Check IP addresses against threat databases"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Endpoint</label>
          <input
            type="text"
            value={formData.endpoint}
            onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
            className="w-full px-3 py-2 border rounded"
            placeholder="/api/ip-reputation"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Query Type</label>
          <select
            value={formData.queryType}
            onChange={(e) => setFormData({ ...formData, queryType: e.target.value as 'ip' | 'hash' })}
            className="w-full px-3 py-2 border rounded"
          >
            <option value="ip">IP Address</option>
            <option value="hash">File Hash</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Price (HBAR per query)</label>
          <input
            type="number"
            step="0.001"
            value={formData.priceHbar}
            onChange={(e) => setFormData({ ...formData, priceHbar: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <button
          onClick={handleVerifyAndPublish}
          disabled={isVerifying || isPublishing || !formData.name || !formData.endpoint}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isVerifying && '🔐 Verifying with World ID...'}
          {isPublishing && '📤 Publishing...'}
          {!isVerifying && !isPublishing && '🌍 Verify & Publish'}
        </button>

        <p className="text-xs text-gray-500 text-center">
          You'll be prompted to verify your identity with World ID before publishing.
          This ensures only real humans can create services.
        </p>
      </div>
    </div>
  );
}

/**
 * Alternative: Using IDKit (for more control over the modal)
 */

import { IDKitWidget, VerificationLevel, ISuccessResult } from '@worldcoin/idkit';

export function PublishServiceWithIDKit() {
  const [formData, setFormData] = useState<ServiceFormData>({
    name: '',
    description: '',
    endpoint: '',
    queryType: 'ip',
    priceHbar: 0.01,
  });
  
  const [showVerification, setShowVerification] = useState(false);

  const handleVerificationSuccess = async (result: ISuccessResult) => {
    try {
      // Send to backend with the proof
      const response = await fetch('/marketplace/services', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Selfie-Check-Proof': JSON.stringify(result),
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to publish service');
      }

      console.log('Service published successfully');
      setShowVerification(false);
    } catch (err) {
      console.error('Error publishing service:', err);
    }
  };

  return (
    <div>
      {/* Form UI (same as above) */}
      
      <button onClick={() => setShowVerification(true)}>
        Verify & Publish
      </button>

      {showVerification && (
        <IDKitWidget
          app_id={import.meta.env.VITE_WORLD_APP_ID}
          action="publish-service"
          signal=""
          onSuccess={handleVerificationSuccess}
          onError={(error) => console.error('Verification error:', error)}
          verification_level={VerificationLevel.Device}
        />
      )}
    </div>
  );
}
